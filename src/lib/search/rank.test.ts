// Ranking and masking: exact code / ID first, then prefix, then contains, recent first on ties;
// matching only sees masked text.
import { describe, expect, it } from "vitest";
import { maskAadhaar, maskEmail, maskGstin, maskIdentifier, maskPan, maskPhone, maskText } from "./mask";
import { arrangeGroups, compareHits, finalise, queryTerms, rankMatch } from "./rank";
import type { SearchHit } from "./types";

const hit = (id: string, rank: 0 | 1 | 2, at: string, type: SearchHit["type"] = "client"): SearchHit => ({ type, id, label: id, context: "", href: `/clients/${id}`, rank, at });

describe("rankMatch", () => {
  it("exact id (case-sensitive), exact code or name, then prefix, then contains", () => {
    expect(rankMatch("cl123", { ids: ["cl123"] })).toBe(0);
    expect(rankMatch("CL123", { ids: ["cl123"] })).toBeNull();
    expect(rankMatch("acme01", { codes: ["ACME01"] })).toBe(0);
    expect(rankMatch("acme", { codes: ["ACME01"] })).toBe(1);
    expect(rankMatch("me0", { codes: ["ACME01"] })).toBe(2);
    expect(rankMatch("Acme Traders", { text: ["acme traders"] })).toBe(0);
    expect(rankMatch("acme", { text: ["Acme Traders"] })).toBe(1);
    expect(rankMatch("traders", { text: ["Acme Traders"] })).toBe(2);
    expect(rankMatch("zenith", { text: ["Acme Traders"] })).toBeNull();
  });

  it("several words must each appear in some field", () => {
    expect(queryTerms("  Acme   GSTR ")).toEqual(["acme", "gstr"]);
    expect(rankMatch("acme gstr", { text: ["GSTR-3B", "Acme Traders"] })).toBe(2);
    expect(rankMatch("acme roc", { text: ["GSTR-3B", "Acme Traders"] })).toBeNull();
  });

  it("matches what the person sees: identifiers inside text are masked before matching", () => {
    expect(rankMatch("AAACA", { text: ["AAACA1234F.pdf"] })).toBeNull();
    expect(rankMatch("234F", { text: ["AAACA1234F.pdf"] })).toBe(2);
    expect(rankMatch("98765", { text: ["Call 9876543210"] })).toBeNull();
    expect(rankMatch("ravi", { text: ["mail ravi@acme.example"] })).toBeNull();
  });
});

describe("ordering", () => {
  it("rank first, then most recent, then label", () => {
    const hits = [hit("b", 2, "2026-11-05"), hit("a", 1, "2026-01-01"), hit("c", 1, "2026-10-01"), hit("z", 0, "2020-01-01")];
    expect([...hits].sort(compareHits).map((h) => h.id)).toEqual(["z", "c", "a", "b"]);
  });

  it("finalise drops non-matches, keeps the best rank per id, caps and flags more", () => {
    const r = finalise([null, hit("a", 2, "2026-01-01"), hit("a", 0, "2026-01-01"), hit("b", 1, "2026-02-01"), hit("c", 2, "2026-03-01")], 2);
    expect(r.hits.map((h) => [h.id, h.rank])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(r.more).toBe(true);
  });

  it("groups: best-ranked group first; overall cap drops the lowest-ranked hits", () => {
    const groups = arrangeGroups(
      [
        { type: "client", hits: [hit("c1", 2, "2026-01-01"), hit("c2", 2, "2025-01-01")], more: false },
        { type: "job", hits: [hit("j1", 0, "2026-01-01", "job")], more: false },
        { type: "run", hits: [], more: false },
      ],
      2,
    );
    expect(groups.map((g) => g.type)).toEqual(["job", "client"]);
    expect(groups[1]).toMatchObject({ label: "Clients", more: true });
    expect(groups[1].hits.map((h) => h.id)).toEqual(["c1"]);
  });
});

describe("masking", () => {
  it("PAN and Aadhaar keep the last 4, phone the last 4 digits, email the first letter and domain", () => {
    expect(maskPan("AAACA1234F")).toBe("XXXXXX234F");
    expect(maskAadhaar("1234 5678 9012")).toBe("XXXX XXXX 9012");
    expect(maskPhone("98765 43210")).toBe("XXXXXX3210");
    expect(maskEmail("Ravi.Acct@Acme.example")).toBe("r***@acme.example");
    expect(maskGstin("33AAACA1234F1Z5")).toBe("33XXXXXXXXXF1Z5");
    expect(maskIdentifier("gstin", "33AAACA1234F1Z5")).toBe("33XXXXXXXXXF1Z5");
  });

  it("maskText catches identifiers inside names, file names and subjects", () => {
    expect(maskText("AAACA1234F_PAN.pdf")).toBe("XXXXXX234F_PAN.pdf");
    expect(maskText("GSTR-1 33AAACA1234F1Z5 Oct")).toBe("GSTR-1 33XXXXXXXXXF1Z5 Oct");
    expect(maskText("Call +91 98765 43210 or mail ravi@acme.example")).toBe("Call XXXXXX3210 or mail r***@acme.example");
    expect(maskText("Aadhaar 1234 5678 9012")).toBe("Aadhaar XXXX XXXX 9012");
    expect(maskText("GSTR-3B 2026-27 ACME01")).toBe("GSTR-3B 2026-27 ACME01");
    expect(maskText(null)).toBe("");
  });

  it("masking is stable when applied twice", () => {
    const once = maskText("AAACA1234F 33AAACA1234F1Z5 9876543210 a@b.example 1234 5678 9012");
    expect(maskText(once)).toBe(once);
  });
});

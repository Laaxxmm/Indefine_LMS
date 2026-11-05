import { describe, expect, it } from "vitest";
import { clientNeedles, scrubberFor, scrubColumns } from "./scrub";

const client = {
  name: "Kiran Kumar",
  folderName: "Kiran Kumar",
  entityType: "INDIVIDUAL",
  pan: "ABCPK1234F",
  gstin: null,
  cin: null,
  contactName: "Kiran Kumar",
  contactPhone: "9876543210",
  contactEmail: "kiran@kumar.test",
  city: "Bengaluru",
};

describe("scrubbing one person's identifiers", () => {
  const s = scrubberFor(clientNeedles(client));

  it("replaces names, PAN (also inside a GSTIN), email and phone in any spacing, keeping the rest", () => {
    expect(s.text("Kiran Kumar (PAN abcpk1234f, GSTIN 29ABCPK1234F1Z5) on +91 98765 43210 / kiran@kumar.test, Bengaluru")).toBe(
      "[erased] (PAN [erased], GSTIN 29[erased]1Z5) on +91 [erased] / [erased], [erased]",
    );
    // Name parts only as whole words; other people's identifiers stay.
    expect(s.text("Kiran called; Kumaran and PAN BCDPL4321M are someone else")).toBe("[erased] called; Kumaran and PAN BCDPL4321M are someone else");
  });

  it("keeps numbers, ids, keys and hashes, and the JSON shape", () => {
    const v = { key: "createClient:kiran", runId: "run-kiran", sha256: "ab12", total: 1200, rows: [{ party: "Kiran Kumar", amount: 5 }], "Kiran Kumar": 3, "[erased]": 4 };
    expect(s.json(v)).toEqual({ key: "createClient:kiran", runId: "run-kiran", sha256: "ab12", total: 1200, rows: [{ party: "[erased]", amount: 5 }], "[erased]": 4, "[erased] (2)": 3 });
    expect(s.hits({ key: "createClient:kiran" })).toBe(false);
  });

  it("finds rows by identifiers only when asked to, never by a name alone", () => {
    expect(s.hits("Onboard Kiran Kumar", ["id"])).toBe(false);
    expect(s.hits("Onboard someone, PAN ABCPK1234F", ["id"])).toBe(true);
    expect(s.hits("Onboard Kiran Kumar")).toBe(true);
  });

  it("changes only the columns that hold a needle", () => {
    expect(scrubColumns({ note: "Call 9876543210", error: "timeout", figures: { a: 1 } }, ["note", "error", "figures"], s)).toEqual({ note: "Call [erased]" });
  });

  it("does not treat already-erased values as needles", () => {
    const erased = scrubberFor(clientNeedles({ ...client, name: "[erased] c-1", folderName: "[erased] c-1", pan: null, contactName: null, contactPhone: null, contactEmail: null, city: null }));
    expect(erased.needles).toEqual([]);
  });
});

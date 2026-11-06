// SOP steps, checklists and copy values: wording rules (the person files, Firm OS never does),
// masking (no PAN or Aadhaar in full), plain copy values, labels kept in step with the close loop.
import type { FirmService } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ackRefFor } from "@/lib/close-loop/review";
import { PORTAL_HOST_RE } from "../../../../scripts/lib/guards";
import { last4, maskIdentifiersInText, maskLast4 } from "../mask";
import { CURRENT_STEP, SERVICE_SOP, checklistFor, nextActionFor, stepsFor, type Action } from "../steps";
import { FULL_IDENTIFIERS, MASKED_PAN_SERVICES, plainRupees, valuesFor } from "../values";

const SERVICES = Object.keys(SERVICE_SOP) as FirmService[];
const ACTIONS = Object.keys(CURRENT_STEP) as Action[];
const ctx = (service: FirmService) => ({ service, period: "2026-10", fy: "2026-27", agentTitle: "Prep agent" });

describe("masking", () => {
  it("keeps only the last four characters", () => {
    expect(maskLast4("ABCDE1234F")).toBe("••••••234F");
    expect(maskLast4(" abcde 1234f ")).toBe("••••••234F");
    expect(maskLast4("2345 6789 0123")).toBe("••••••••0123");
    expect(maskLast4("ABCD")).toBe("••••");
    expect(maskLast4("")).toBeNull();
    expect(maskLast4(null)).toBeNull();
    expect(last4("29ABCDE1234F1Z5")).toBe("F1Z5");
    expect(last4("AB")).toBeNull();
  });

  it("masks a PAN or Aadhaar number inside free text, and leaves other text alone", () => {
    expect(maskIdentifiersInText("ITR for ABCDE1234F")).toBe("ITR for ••••••234F");
    expect(maskIdentifiersInText("Aadhaar 2345 6789 0123 seeding")).toBe("Aadhaar ••••••••0123 seeding");
    expect(maskIdentifiersInText("GSTR-3B Oct 2026")).toBe("GSTR-3B Oct 2026");
  });
});

describe("steps", () => {
  it("seven steps for every service; exactly one current; earlier ones done", () => {
    for (const s of SERVICES)
      for (const a of ACTIONS) {
        const steps = stepsFor(ctx(s), a);
        expect(steps).toHaveLength(7);
        expect(steps.filter((x) => x.current).map((x) => x.n)).toEqual([CURRENT_STEP[a]]);
        expect(steps.filter((x) => x.done).map((x) => x.n)).toEqual(Array.from({ length: CURRENT_STEP[a] - 1 }, (_, i) => i + 1));
      }
  });

  it("the filing step is always the person's own: portal services say 'yourself' and 'never files'", () => {
    for (const s of SERVICES) {
      const file = stepsFor(ctx(s), "file")[4];
      if (SERVICE_SOP[s].portal) {
        expect(file.where).toBe("portal");
        expect(file.text).toMatch(/yourself/);
        expect(file.text).toMatch(/Firm OS never files/);
      } else {
        expect(file.where).toBe("offline");
        expect(file.text).toMatch(/Firm OS (sends nothing|gives no audit opinion|only drafts)/);
      }
    }
  });

  it("no text tells Firm OS to file, submit, pay or send, and none names a portal host", () => {
    const all = SERVICES.flatMap((s) =>
      ACTIONS.flatMap((a) => [
        ...stepsFor(ctx(s), a).map((x) => x.text),
        ...checklistFor({ ...ctx(s), gstinLast4: "F1Z5", blockFails: 2, warnFails: 1 }, a),
        nextActionFor(ctx(s), a),
        nextActionFor({ ...ctx(s), agentTitle: null }, a),
      ]),
    );
    for (const t of all) {
      expect(PORTAL_HOST_RE.test(t)).toBe(false);
      expect(t).not.toMatch(/submit to (the )?portal|Firm OS (files|submits|pays|sends it)|enter (the )?OTP/i);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("acknowledgement labels match what Mark filed asks for (close loop)", () => {
    for (const s of SERVICES) {
      const close = ackRefFor(s);
      expect(SERVICE_SOP[s].ack).toBe(close.required ? close.label : null);
    }
  });

  it("checklists are short and count open findings", () => {
    for (const s of SERVICES) for (const a of ACTIONS) expect(checklistFor({ ...ctx(s), gstinLast4: null, blockFails: 0, warnFails: 0 }, a).length).toBeLessThanOrEqual(5);
    expect(checklistFor({ ...ctx("GST"), gstinLast4: null, blockFails: 2, warnFails: 1 }, "check")).toEqual([
      "2 block findings on the latest run cleared or explained",
      "1 warning read and noted",
      "Figures tie to the client's registers",
      "Pack submitted for review in Firm OS",
    ]);
    expect(checklistFor({ ...ctx("Books"), gstinLast4: null, blockFails: 0, warnFails: 0 }, "file")).toContain("Nothing is sent to the client from Firm OS");
    expect(stepsFor({ ...ctx("GST"), agentTitle: null }, "prepare")[1].text).toBe("Prepare the working for 2026-10 yourself.");
  });
});

describe("copy values", () => {
  const src = (service: FirmService, approvedFigures: unknown = null) => ({
    service,
    clientName: "Acme Traders Private Limited",
    clientCode: "ACME",
    period: "2026-10",
    fy: "2026-27",
    gstin: "29abcde1234f1z5",
    pan: "ABCDE1234F",
    cin: "U12345KA2020PTC123456",
    approvedFigures,
  });

  it("identifiers in full only where the SOP pastes them; PAN never in full", () => {
    for (const s of SERVICES) {
      const vals = valuesFor(src(s));
      const keys = vals.map((v) => v.key);
      expect(keys.includes("gstin")).toBe(FULL_IDENTIFIERS[s].includes("gstin"));
      expect(keys.includes("cin")).toBe(FULL_IDENTIFIERS[s].includes("cin"));
      expect(keys.includes("pan")).toBe(MASKED_PAN_SERVICES.has(s));
      expect(JSON.stringify(vals)).not.toMatch(/"ABCDE1234F"/);
      for (const v of vals.filter((x) => x.key === "pan")) expect(v.copy).toBeNull();
    }
    expect(valuesFor(src("GST")).find((v) => v.key === "gstin")?.copy).toBe("29ABCDE1234F1Z5");
  });

  it("amounts: paise figures only, plain for pasting, ₹ with Indian grouping for reading", () => {
    const vals = valuesFor(src("GST", { taxPaise: 1234567, zeroPaise: 0, refundPaise: -101, notesCount: 3, badPaise: 1.5, textPaise: "100" }));
    const fig = vals.filter((v) => v.key.startsWith("figure:"));
    expect(fig.map((v) => [v.key, v.copy, v.display])).toEqual([
      ["figure:taxPaise", "12345.67", "₹12,345.67"],
      ["figure:zeroPaise", "0.00", "₹0.00"],
      ["figure:refundPaise", "-1.01", "₹-1.01"],
    ]);
    expect(valuesFor(src("GST", "not an object")).some((v) => v.key.startsWith("figure:"))).toBe(false);
    expect(plainRupees(100)).toBe("1.00");
    expect(plainRupees(-5)).toBe("-0.05");
    expect(plainRupees(0)).toBe("0.00");
  });
});

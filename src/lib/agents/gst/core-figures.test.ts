// Mandatory core GSTR-3B figure set: every GST accuracy fixture must pin these keys (hand-computed),
// so a fixture can never pass on a handful of figures while the 3B totals drift. The keys are the
// ones computeFigures returns for Table 3.1 (outward, per head), Table 4 (ITC available, reversed,
// net, and the ITC held back on bills the model abstained on — owner-approved 2026-11-05) and
// Table 6.1 (cash per head), plus days late, interest and late fee. ITC per head is not a computed
// figure today (only the total); the per-head cash figures carry the set-off result.
import { describe, expect, it } from "vitest";
import { loadFixtures } from "@/lib/agents/core/accuracy-run";

const GST_CORE_FIGURES = [
  "outwardTaxablePaise",
  "outwardIgstPaise",
  "outwardCgstPaise",
  "outwardSgstPaise",
  "outwardCessPaise",
  "outwardTaxPaise",
  "itcAvailablePaise",
  "itcBlockedPaise",
  "itcOtherReversalPaise",
  "itcNetPaise",
  "itcHeldBackPaise",
  "cashIgstPaise",
  "cashCgstPaise",
  "cashSgstPaise",
  "cashCessPaise",
  "cashTaxPaise",
  "daysLate",
  "interestPaise",
  "lateFeePaise",
] as const;

describe("GST fixtures pin the core 3B figure set", () => {
  const fixtures = loadFixtures("fixtures/accuracy", "gst");
  it("has fixtures", () => expect(fixtures.length).toBeGreaterThanOrEqual(15));
  it.each(fixtures.map((f) => [f.id, f] as const))("%s pins every core figure", (_id, f) => {
    expect(GST_CORE_FIGURES.filter((k) => !(k in f.expected.figures))).toEqual([]);
  });
  it("the per-head figures add up in every fixture (outward tax and cash)", () => {
    for (const f of fixtures) {
      const x = f.expected.figures;
      expect(x.outwardIgstPaise + x.outwardCgstPaise + x.outwardSgstPaise + x.outwardCessPaise, f.id).toBe(x.outwardTaxPaise);
      expect(x.cashIgstPaise + x.cashCgstPaise + x.cashSgstPaise + x.cashCessPaise, f.id).toBe(x.cashTaxPaise);
      expect(x.itcNetPaise, f.id).toBeLessThanOrEqual(x.itcAvailablePaise);
      expect(x.itcHeldBackPaise, f.id).toBeGreaterThanOrEqual(0);
    }
  });
});

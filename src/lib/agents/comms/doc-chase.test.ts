// Doc-chase suggestions from an agent run: the missing-document rules' lists and the model's
// abstentions (open questions marked as client document requests).
import { describe, expect, it } from "vitest";
import { docChaseSuggestions, fitItem } from "./doc-chase";

describe("docChaseSuggestions", () => {
  it("splits missing-document lists and adds abstentions; ignores passes and reviewer-only questions", () => {
    const rows = [
      { ruleId: "tax.missing-docs", status: "fail", message: "Ask the client / staff for: Form 26AS (downloaded from TRACES by staff); Annual Information Statement (AIS / TIS)", evidence: { location: "documents" } },
      { ruleId: "audit.inputs-missing", status: "fail", message: "Not provided (listed under Pending information): Fixed asset register; Bank confirmations." },
      { ruleId: "gst.blocked-credit", status: "na", message: "Purpose of the expense booked as Staff welfare, with the bill", evidence: { flags: ["insufficient-evidence"], location: "purchases.csv row 4" } },
      { ruleId: "gst.free-supplies", status: "na", message: "Two reads disagree", evidence: { flags: ["model-disagreement"] } },
      { ruleId: "tax.missing-docs-other", status: "fail", message: "Not a list rule: X; Y" },
      { ruleId: "books.missing-docs", status: "pass", message: "all expected documents supplied" },
    ];
    expect(docChaseSuggestions(rows)).toEqual([
      "Form 26AS (downloaded from TRACES by staff)",
      "Annual Information Statement (AIS / TIS)",
      "Fixed asset register",
      "Bank confirmations",
      "Purpose of the expense booked as Staff welfare, with the bill",
    ]);
  });

  it("de-duplicates, skips blanks and a list message without a colon, and caps the number", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Doc ${i}`).join("; ");
    expect(docChaseSuggestions([{ ruleId: "x.missing-docs", status: "fail", message: `For: ${many}; doc 0; ` }])).toHaveLength(20);
    expect(docChaseSuggestions([{ ruleId: "x.missing-docs", status: "fail", message: "nothing listed" }])).toEqual([]);
    expect(docChaseSuggestions([{ ruleId: "r", status: "na", message: "  ", evidence: { flags: ["insufficient-evidence"] } }])).toEqual([]);
  });

  it("fitItem trims long questions at a word boundary to the 160-character item limit", () => {
    const long = `Please provide ${"the purchase register with invoice dates ".repeat(6)}`;
    const fit = fitItem(long);
    expect(fit.length).toBeLessThanOrEqual(160);
    expect(fit.endsWith("…")).toBe(true);
    expect(fitItem("Bank statement for October 2026.")).toBe("Bank statement for October 2026");
  });
});

// Grounding validator for comms.polish (Phase 10): a faithful rewrite passes; an invented date,
// amount or reference, a dropped or reformatted fact, an extra paragraph, a new ask or new jargon
// is rejected with a message the model can act on.
import { describe, expect, it } from "vitest";
import { validatePolish, type PolishOutput } from "./grounding";
import { buildTemplate, type Template } from "./templates";
import { SAMPLES } from "../../../../tests/fakes/comms-fixtures";

const reminder: Template = buildTemplate(SAMPLES["due-reminder"]);
const filed: Template = buildTemplate(SAMPLES["filing-completed"]);
const query: Template = buildTemplate(SAMPLES["query-response"]);

const ok = (t: Template, paragraphs: string[], subject = t.subject): PolishOutput => ({ status: "polished", subject, paragraphs });
const issues = (t: Template, out: PolishOutput) => validatePolish(out, { template: t });

describe("validatePolish", () => {
  it("accepts the template itself and a faithful rewrite", () => {
    expect(issues(reminder, ok(reminder, reminder.paragraphs))).toEqual([]);
    expect(
      issues(
        reminder,
        ok(reminder, ["Your GSTR-3B for October 2026 is due on 20 Nov 2026.", "Please pay ₹1,23,456.00 by 18 Nov 2026."], "Your GSTR-3B for October 2026 is due on 20 Nov 2026 (Acme Traders Private Limited)"),
      ),
    ).toEqual([]);
  });

  it("accepts insufficient_evidence (the caller keeps the template wording)", () => {
    expect(issues(reminder, { status: "insufficient_evidence", subject: "", paragraphs: ["x"] })).toEqual([]);
  });

  it("rejects an invented date", () => {
    const out = ok(reminder, ["Your GSTR-3B for October 2026 is due on 20 Nov 2026.", "Please pay ₹1,23,456.00 by 15 Nov 2026."]);
    const found = issues(reminder, out);
    expect(found).toContain('paragraph 2: keep the date "18 Nov 2026" exactly as written');
    expect(found).toContain('paragraph 2: "15 Nov 2026" is a new date; use only the facts given');
  });

  it("rejects an invented amount, and a reformatted one is named as such", () => {
    const invented = issues(reminder, ok(reminder, [reminder.paragraphs[0], "Please pay ₹1,25,000.00 by 18 Nov 2026."]));
    expect(invented).toContain('paragraph 2: "₹1,25,000.00" is a new amount; use only the facts given');
    const reformatted = issues(reminder, ok(reminder, [reminder.paragraphs[0], "Please pay Rs. 1,23,456.00 by 18 Nov 2026."]));
    expect(reformatted).toContain('paragraph 2: "Rs. 1,23,456.00" must be written exactly as in the facts');
    expect(reformatted).toContain('paragraph 2: keep the amount "₹1,23,456.00" exactly as written');
  });

  it("rejects a changed ack ref and new numbers, weekdays, relative dates, links", () => {
    expect(issues(filed, ok(filed, [filed.paragraphs[0], "The acknowledgement number is AA2911260123465.", filed.paragraphs[2]]))).toContain(
      'paragraph 2: "AA2911260123465" is a new reference; use only the facts given',
    );
    const extra = issues(filed, ok(filed, [`${filed.paragraphs[0]} We did it on Monday, 2 days early.`, filed.paragraphs[1], `${filed.paragraphs[2]} See www.indefine.in tomorrow.`]));
    expect(extra.join("\n")).toMatch(/paragraph 1: "2" is a new number/);
    expect(extra.join("\n")).toMatch(/paragraph 1: a month or weekday/);
    expect(extra.join("\n")).toMatch(/paragraph 3: a relative date/);
    expect(extra.join("\n")).toMatch(/paragraph 3: an e-mail address or link/);
  });

  it("rejects a dropped client name in the subject and a month name outside a fact", () => {
    const found = issues(reminder, ok(reminder, reminder.paragraphs, "Reminder: GSTR-3B for October 2026 is due in November"));
    expect(found).toContain('subject: keep the name "Acme Traders Private Limited" exactly as written');
    expect(found).toContain("subject: a month or weekday that is not part of a fact date");
  });

  it("rejects a different paragraph count, padding, a new ask and new jargon", () => {
    expect(issues(reminder, ok(reminder, [reminder.paragraphs.join(" ")]))[0]).toMatch(/return exactly 2 paragraphs/);
    const padded = `${filed.paragraphs[0]} ${"We are always happy to help you with all your filings and more. ".repeat(3)}`;
    expect(issues(filed, ok(filed, [padded, filed.paragraphs[1], filed.paragraphs[2]]))).toContain("paragraph 1: much longer than the template; do not add content");
    expect(issues(filed, ok(filed, [filed.paragraphs[0], filed.paragraphs[1], `${filed.paragraphs[2]} Please confirm receipt.`]))).toContain(
      "the template asks the client for nothing; do not add a request or a question",
    );
    expect(issues(reminder, ok(reminder, [reminder.paragraphs[0], "Kindly pay ₹1,23,456.00 by 18 Nov 2026 to avoid delay."])).join("\n")).toMatch(/tone: "kindly"/);
  });

  it("staff-written numbers in a query answer must survive exactly", () => {
    const out = ok(query, [query.paragraphs[0], "GST at 18% applies to the monthly rent of ₹50,000.00 from October 2026.", query.paragraphs[2]]);
    expect(issues(query, out)).toEqual([]);
    const changed = ok(query, [query.paragraphs[0], "GST at 12% applies to the monthly rent of ₹50,000.00 from October 2026.", query.paragraphs[2]]);
    expect(issues(query, changed).join("\n")).toMatch(/keep the token "18%"/);
  });
});

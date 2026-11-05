// Grounding (ADR-008 §4): quotes must occur in the documents; grounded numbers must appear in
// their quote; ungrounded items are dropped with the smallest array element that holds them.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GroundingError, groundCheck, numberInQuote, numbersIn } from "./grounding";
import { abstainable, evidence, groundedNumber } from "./schema";

const SOURCE = ["purchase.csv row 2: Sunrise Steel | MS rods | ₹1,23,456.00", "purchase.csv row 3: Westline Packaging | Corrugated boxes | Rs. 10,000", "purchase.csv row 4: Prime Components | Rent | 25000.50"].join("\n");
const Line = z.object({ supplier: z.string().max(100), amount: groundedNumber(), quote: z.string().max(300), location: z.string().max(100) });
const Out = z.object({ lines: z.array(Line) });

describe("numbersIn / numberInQuote", () => {
  it("reads Indian and international grouping, ₹ and Rs, to the paisa", () => {
    expect([...numbersIn("₹1,23,456.00 and Rs. 10,000 and 1,234,567.5")]).toEqual(expect.arrayContaining([12345600, 1000000, 123456750]));
    expect(numberInQuote(123456, "₹1,23,456.00")).toBe(true);
    expect(numberInQuote(123456.0, "1,23,456")).toBe(true);
    expect(numberInQuote(123465, "1,23,456")).toBe(false);
    expect(numberInQuote(12345600, "₹1,23,456.00", true)).toBe(true); // paise field vs rupee quote
    expect(numberInQuote(-2000, "credit note -2,000.00")).toBe(true); // magnitude
    expect(numberInQuote(Number.NaN, "1")).toBe(false);
    // CSV commas between cells are not digit grouping.
    expect(numberInQuote(15000, "2026-10-05,15000.00")).toBe(true);
  });
});

describe("groundCheck", () => {
  const good = { supplier: "Sunrise Steel", amount: 123456, quote: "sunrise   steel | MS RODS | ₹1,23,456.00", location: "purchase.csv row 2" };

  it("keeps grounded items (quote whitespace / case normalised; number in the quote)", () => {
    const r = groundCheck({ lines: [good] }, SOURCE, { schema: Out });
    expect(r).toMatchObject({ output: { lines: [good] }, checked: 2, ungrounded: 0, rootUngrounded: false, issues: [] });
  });

  it("drops an item whose quote is not in the documents, and counts it", () => {
    const fake = { ...good, quote: "Sunrise Steel | TMT bars | ₹1,23,456.00" };
    const r = groundCheck({ lines: [fake, { supplier: "Westline", amount: 10000, quote: "Westline Packaging | Corrugated boxes | Rs. 10,000", location: "purchase.csv row 3" }] }, SOURCE, { schema: Out });
    expect(r.output.lines.map((l) => l.supplier)).toEqual(["Westline"]);
    expect(r.ungrounded).toBe(1);
    expect(r.issues[0]).toMatchObject({ path: "lines[0]", reason: expect.stringMatching(/does not occur in the documents/) });
  });

  it("drops a grounded number that is not in its quote (1,23,456 written, 123465 returned)", () => {
    const r = groundCheck({ lines: [{ ...good, amount: 123465 }] }, SOURCE, { schema: Out });
    expect(r.output.lines).toEqual([]);
    expect(r.ungrounded).toBe(1);
    expect(r.issues).toEqual([{ path: "lines[0].amount", reason: expect.stringMatching(/123465 does not appear in its quote/) }]);
  });

  it("a grounded number with no quote beside it is ungrounded; without the schema numbers are not checked", () => {
    const S = z.object({ rows: z.array(z.object({ n: groundedNumber() })) });
    expect(groundCheck({ rows: [{ n: 5 }] }, SOURCE, { schema: S })).toMatchObject({ ungrounded: 1, output: { rows: [] } });
    expect(groundCheck({ lines: [{ ...good, amount: 999 }] }, SOURCE)).toMatchObject({ ungrounded: 0 });
  });

  it("an ungrounded object outside any array makes the whole output unusable", () => {
    const r = groundCheck({ status: "fail", evidence: { quote: "nowhere", location: "row 9" } }, SOURCE);
    expect(r.rootUngrounded).toBe(true);
    expect(r.ungrounded).toBe(1);
    expect(new GroundingError("gst.x@1", r.issues).message).toMatch(/^Model output for gst\.x@1 is not grounded in the documents: evidence quote "nowhere"/);
  });

  it("an empty quote or location is ungrounded, except on an abstention", () => {
    const S = z.object({ items: z.array(z.object({ head: abstainable(z.enum(["rent"])), evidence: evidence() })) });
    const r = groundCheck({ items: [{ head: "insufficient_evidence", evidence: { quote: "", location: "" } }, { head: "rent", evidence: { quote: "", location: "row 4" } }] }, SOURCE, { schema: S });
    expect(r.output.items).toEqual([{ head: "insufficient_evidence", evidence: { quote: "", location: "" } }]);
    expect(r.issues).toEqual([{ path: "items[1].evidence", reason: "has an empty quote or location" }]);
  });

  it("each ungrounded item leaves its own array; an ungrounded element counts once with what it holds; the input is not modified", () => {
    const input = { docs: [{ lines: [{ quote: "nope", location: "x" }, { quote: "nope 2", location: "y" }] }, { lines: [{ quote: "Rent", location: "row 4" }] }] };
    const before = JSON.stringify(input);
    const r = groundCheck(input, SOURCE);
    expect(r.output).toEqual({ docs: [{ lines: [] }, { lines: [{ quote: "Rent", location: "row 4" }] }] });
    expect(r.ungrounded).toBe(2);
    expect(JSON.stringify(input)).toBe(before);
    const outer = groundCheck({ docs: [{ quote: "bad doc", location: "x", lines: [{ quote: "bad line", location: "y" }] }] }, SOURCE);
    expect(outer).toMatchObject({ output: { docs: [] }, ungrounded: 1 });
    expect(outer.issues).toHaveLength(2);
  });
});

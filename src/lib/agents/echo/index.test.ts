// Echo's register is parsed by code: amounts by string arithmetic, every problem named with its
// row; the accuracy probe adds exactly ₹1 to the first entry and leaves the originals alone.
import { describe, expect, it } from "vitest";
import type { InputFile } from "@/lib/agents/core/runner";
import { validateScope } from "@/lib/agents/core/guardrails/scope";
import { unboundedStrings } from "@/lib/agents/core/guardrails/schema";
import { ECHO_CHECKLIST, ECHO_RELATED_PARTY_SPEC, ECHO_SCOPE, echoAgent, echoInputSchema, echoInputSniff, echoProbeMutation, paiseToRupees, parseEchoRegister, rupeesToPaise, splitCsvLine, validateEchoVerdict } from "./index";

const file = (csv: string, name = "register.csv"): InputFile => ({ name, source: "fixture", bytes: Buffer.from(csv) });

describe("register parsing", () => {
  it("rupees → paise without floating point", () => {
    expect(rupeesToPaise("15000.00")).toBe(1500000);
    expect(rupeesToPaise("8999.99")).toBe(899999);
    expect(rupeesToPaise("8999.9")).toBe(899990);
    expect(rupeesToPaise("-2000")).toBe(-200000);
    expect(rupeesToPaise("1,00,500.00")).toBe(10050000);
    expect(rupeesToPaise("0.10")).toBe(10);
    for (const bad of ["", "12ab", "1.234", "₹100", "1e5", "--1"]) expect(rupeesToPaise(bad)).toBeNull();
    expect(paiseToRupees(1500001)).toBe("15000.01");
    expect(paiseToRupees(-200000)).toBe("-2000.00");
    expect(paiseToRupees(5)).toBe("0.05");
  });

  it("CSV cells: quotes, embedded commas, escaped quotes, trimming", () => {
    expect(splitCsvLine('INV-1, "Mehta, Shah & Co" ,2026-10-05,"1,000.00"')).toEqual(["INV-1", "Mehta, Shah & Co", "2026-10-05", "1,000.00"]);
    expect(splitCsvLine('A,"say ""hi""",d,1')).toEqual(["A", 'say "hi"', "d", "1"]);
  });

  it("parses rows, skips blank lines, accepts a BOM and CRLF", () => {
    const r = parseEchoRegister("﻿ref,party,date,amount\r\nINV-1,Acme,2026-10-05,15000.00\r\n\r\nCN-1,Acme,2026-10-06,-2000\r\n");
    expect(r).toEqual({
      errors: [],
      rows: [
        { ref: "INV-1", party: "Acme", date: "2026-10-05", amountPaise: 1500000 },
        { ref: "CN-1", party: "Acme", date: "2026-10-06", amountPaise: -200000 },
      ],
    });
  });

  it("reports every problem with its row and keeps the good rows", () => {
    const r = parseEchoRegister(["ref,party,date,amount", "INV-1,Acme,2026-10-05,1.00", "INV-2,Acme,2026-02-30,1.00", "INV-3,Acme,2026-10-05", "INV-4,,2026-10-05,x"].join("\n"));
    expect(r.rows.map((x) => x.ref)).toEqual(["INV-1"]);
    expect(r.errors).toEqual([
      'register.csv row 3: date "2026-02-30" is not a YYYY-MM-DD calendar date',
      "register.csv row 4: expected 4 columns, found 3",
      'register.csv row 5: party is blank; amount "x" is not a rupee amount',
    ]);
    expect(parseEchoRegister("a,b\n1,2").errors[0]).toMatch(/header must be ref,party,date,amount/);
    expect(parseEchoRegister("ref,party,date,amount").errors).toEqual(["register.csv has a header but no entries"]);
  });

  it("inputSchema: rows come from the file; parse problems are input issues", () => {
    const ok = echoInputSchema.safeParse([file("ref,party,date,amount\nINV-1,Acme,2026-10-05,10.50")]);
    expect(ok.success && ok.data.rows).toEqual([{ ref: "INV-1", party: "Acme", date: "2026-10-05", amountPaise: 1050 }]);
    const bad = echoInputSchema.safeParse([file("ref,party,date,amount\nINV-1,Acme,2026-10-05,ten")]);
    expect(!bad.success && bad.error.issues.map((i) => i.message)).toEqual(['register.csv row 2: amount "ten" is not a rupee amount']);
  });

  it("extract makes no model call and hands on the parse", async () => {
    const input = { fileName: "register.csv", csv: "", rows: [{ ref: "A", party: "P", date: "2026-10-05", amountPaise: 100 }] };
    const model = () => {
      throw new Error("echo must not call the model to read the register");
    };
    const extracted = await echoAgent.extract({ input, files: [], job: {} as never, runId: "r", notes: null, model: model as never });
    expect(extracted).toEqual({ rows: input.rows });
    expect(extracted.rows).not.toBe(input.rows);
  });
});

describe("probeMutation", () => {
  it("adds ₹1 to the first entry only and does not modify the originals", () => {
    const csv = "ref,party,date,amount\n\nINV-1,\"Mehta, Shah\",2026-10-05,15000.00\nINV-2,B,2026-10-06,10.00";
    const files = [file("other", "notes.txt"), file(csv)];
    const out = echoProbeMutation(files);
    expect(out[0]).toBe(files[0]);
    expect(files[1].bytes.toString()).toBe(csv);
    expect(out[1].bytes.toString()).toBe('ref,party,date,amount\n\nINV-1,"Mehta, Shah",2026-10-05,15001.00\nINV-2,B,2026-10-06,10.00');
    const before = parseEchoRegister(csv).rows;
    const after = parseEchoRegister(out[1].bytes.toString()).rows;
    expect(after[0].amountPaise - before[0].amountPaise).toBe(100);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it("returns the files unchanged when there is nothing to mutate", () => {
    const none = [file("x", "notes.txt")];
    expect(echoProbeMutation(none)).toBe(none);
    const headerOnly = [file("ref,party,date,amount\n")];
    expect(echoProbeMutation(headerOnly)).toBe(headerOnly);
    const unparsable = [file("ref,party,date,amount\nINV-1,A,2026-10-05,abc")];
    expect(echoProbeMutation(unparsable)).toBe(unparsable);
  });
});

describe("ADR-008 scope", () => {
  it("department Books, one versioned high-stakes task, every rule owned, a closed abstainable schema", () => {
    expect(validateScope(echoAgent)).toEqual([]);
    expect(ECHO_SCOPE).toMatchObject({ department: "Books", ruleIds: ECHO_CHECKLIST.rules.map((r) => r.id) });
    expect(ECHO_RELATED_PARTY_SPEC).toMatchObject({ name: "echo.check:echo.related-party", version: 2, highStakes: true, difficulty: "judgement" });
    expect(unboundedStrings(ECHO_RELATED_PARTY_SPEC.schema)).toEqual([]);
    expect(ECHO_RELATED_PARTY_SPEC.schema.safeParse({ status: "insufficient_evidence" }).success).toBe(true);
    expect(echoAgent.inputProbes?.map((p) => p.input)).toEqual(["register.csv"]);
  });
  it("the sniff rejects a register.csv without the register header, naming the right agent", () => {
    expect(echoInputSniff([file("ref,party,date,amount\nINV-1,A,2026-10-05,1.00")])).toEqual({ ok: true });
    expect(echoInputSniff([file("﻿Ref,Party,Date,Amount\n")])).toEqual({ ok: true });
    expect(echoInputSniff([])).toEqual({ ok: true }); // missing: the input schema says so
    expect(echoInputSniff([file("   ")])).toEqual({ ok: true });
    expect(echoInputSniff([file("invoice_no,gstin,taxable_value\nS1,29X,1")])).toMatchObject({ ok: false, suggestAgent: "gst", reason: expect.stringMatching(/looks like a GST register$/) });
    expect(echoInputSniff([file("ledger,debit,credit\nCash,1,")])).toMatchObject({ ok: false, suggestAgent: "books", reason: expect.stringMatching(/looks like a trial balance$/) });
    expect(echoInputSniff([file("invoice,customer,amount")])).toEqual({ ok: false, reason: 'register.csv header must be ref,party,date,amount (found "invoice,customer,amount")', suggestAgent: undefined });
  });
  it("the verdict validator: the cited row must be a row the model was shown", () => {
    const docs = "register.csv row 2: INV-1 | Acme | 2026-10-05 | 1.00";
    expect(validateEchoVerdict({ status: "pass", evidence: { quote: "Acme", location: "register.csv row 2" } }, docs)).toEqual([]);
    expect(validateEchoVerdict({ status: "fail", evidence: { quote: "Acme", location: "register.csv row 7" } }, docs)).toEqual(['location "register.csv row 7" is not a register row shown']);
    expect(validateEchoVerdict({ status: "insufficient_evidence" }, docs)).toEqual([]);
  });
});

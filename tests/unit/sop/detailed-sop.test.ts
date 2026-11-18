// The detailed SOP format: numbering is deterministic, credentials never survive, and both the
// detailed and the older flat content still render to a Word file.
import { describe, expect, it } from "vitest";
import { assembleSop, generateSop, stripBriefSecrets, stripSecrets } from "@/lib/sop/gemini";
import { renderSopDocx } from "@/lib/sop/render";
import { MAX_SUB_PROCESSES, type SopBrief } from "@/lib/sop/types";

const brief: SopBrief = { title: "Monthly bank reconciliation", department: "ACCOUNTS", workCategory: "Books", objective: "o", scope: "s", keySteps: [], rolesInvolved: [], references: [], subProcesses: ["Collect statements", "Match and clear"] };
const meta = { effectiveDate: "11/11/2026", revision: "1.0" };
const frame = { purpose: "p", scope: "s", definitions: [], responsibilities: [], kpis: ["Closed by the 5th"], risks: [{ risk: "Entry missed", control: "Reviewer ties balance", owner: "Manager", frequency: "Monthly" }], references: [] };
const step = (over: Partial<{ check: string; checkType: string; ifThen: string[] }> = {}) => ({ role: "Article Assistant", action: "Open the bank ledger", system: "Tally Prime > Display", input: "", output: "", ifThen: [], check: "", checkType: "", ...over });

describe("stripSecrets", () => {
  it("cuts anything that reads like a credential", () => {
    expect(stripSecrets("Username: ap@x.com Password: Sample#2026")).not.toContain("Sample#2026");
    expect(stripSecrets("the pwd = Hunter2")).not.toContain("Hunter2");
    expect(stripSecrets("password is Tr0ub4dor now")).not.toContain("Tr0ub4dor");
  });
  it("leaves ordinary sentences alone", () => {
    const s = "The password is in the partner's vault; ask the manager.";
    expect(stripSecrets(s)).toBe(s);
  });
  it("is idempotent, so re-stripping a saved description on each new version changes nothing", () => {
    const once = stripSecrets("Log in. Password: Abc@123 then go.");
    expect(once).not.toContain("Abc@123");
    expect(stripSecrets(once)).toBe(once);
  });
  it.each([
    ["OTP 123456", "123456"],
    ["password - Abc@123", "Abc@123"],
    ["password Abc@123", "Abc@123"],
  ])("cuts a bare or dashed value with a digit or symbol: %s", (text, secret) => {
    const once = stripSecrets(text);
    expect(once).not.toContain(secret);
    expect(stripSecrets(once)).toBe(once);
  });
  it.each(["The password is in the partner's vault", "a password-protected file", "enter the OTP sent to the client", "Password – see the manager"])("leaves alone: %s", (s) => {
    expect(stripSecrets(s)).toBe(s);
  });
  it("strips every free-text field of a brief", () => {
    const dirty: SopBrief = { ...brief, title: "pwd: x1", workCategory: "otp 1234", objective: "password Abc@1", scope: "passcode = 99", keySteps: ["api key: K9"], rolesInvolved: ["pwd 7a"], references: ["OTP 555"], subProcesses: ["password - P@ss"] };
    const clean = JSON.stringify(stripBriefSecrets(dirty));
    for (const s of ["x1", "1234", "Abc@1", "99", "K9", "7a", "555", "P@ss"]) expect(clean).not.toContain(s);
    expect(stripBriefSecrets(dirty).department).toBe("ACCOUNTS");
  });
});

describe("generateSop sub-process limit", () => {
  it(`refuses more than ${MAX_SUB_PROCESSES} sub-processes instead of dropping some`, async () => {
    const tooMany = { ...brief, subProcesses: Array.from({ length: MAX_SUB_PROCESSES + 1 }, (_, i) => `Part ${i + 1}`) };
    await expect(generateSop(tooMany, "A description long enough.", meta, { dictionary: async () => [] })).rejects.toThrow(`Keep it to ${MAX_SUB_PROCESSES} sub-processes`);
  });
});

describe("assembleSop", () => {
  const c = assembleSop(brief, meta, frame, [
    { name: "Collect statements", draft: { objective: "o1", owner: "Senior", steps: [step(), step({ check: "Statement balance equals ledger balance", checkType: "MANUAL" })], toConfirm: ["Which folder?"] } },
    { name: "Match and clear", draft: { objective: "o2", owner: "Senior", steps: [step({ check: "Voucher date locked", checkType: "APPLICATION", ifThen: ["If the amount differs, then raise a query"] }), step({ check: "Reviewer signs", checkType: "" })], toConfirm: [] } },
  ]);
  it("numbers steps per sub-process and controls across the whole SOP", () => {
    expect(c.schemaVersion).toBe(2);
    expect(c.subProcesses!.map((p) => p.steps.map((s) => s.no))).toEqual([["P01.1", "P01.2"], ["P02.1", "P02.2"]]);
    expect(c.subProcesses!.flatMap((p) => p.steps.map((s) => s.control))).toEqual(["", "C1", "AC1", "C2"]);
    expect(c.controls!.map((k) => `${k.id}:${k.type}`)).toEqual(["C1:MANUAL", "AC1:APPLICATION", "C2:MANUAL"]);
  });
  it("keeps the process map, the flat list for older readers, and the open points", () => {
    expect(c.flowchart).toEqual(["P01 · Collect statements", "P02 · Match and clear"]);
    expect(c.procedure.map((p) => p.step)).toEqual([1, 2, 3, 4]);
    expect(c.openPoints).toEqual(["P01: Which folder?"]);
  });
  it("renders detailed and older content to a Word file", async () => {
    const detailed = await renderSopDocx(c);
    const flat = await renderSopDocx({ ...c, schemaVersion: undefined, subProcesses: undefined });
    for (const buf of [detailed, flat]) expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(detailed.length).toBeGreaterThan(flat.length);
  });
});

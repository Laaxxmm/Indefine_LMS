// Comms model tasks are ADR-008 task specs: declared per department, closed outputs with capped
// strings and an abstain option, FIRM_PREAMBLE + department preamble + comms preamble, locked in
// prompts.lock.json (the existing task entries are untouched).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { FIRM_PREAMBLE, composeSystemPrompt, departmentPreamble, hasAbstainOption, unboundedStrings, validateScope } from "@/lib/agents/core/guardrails";
import { PROMPT_LOCK_FILE, currentPrompts, parsePromptLock, verifyPromptLock } from "@/lib/agents/core/guardrails/prompt-lock";
import { AGENTS } from "@/lib/agents/registry";
import { COMMS_PREAMBLE, COMMS_PROMPT_OWNERS, COMMS_SCOPES, COMMS_TASKS } from "./tasks";
import { FIRM_SERVICES } from "./types";

const allSpecs = () => FIRM_SERVICES.flatMap((d) => Object.values(COMMS_TASKS[d]).map((s) => ({ d, s })));

describe("comms task specs", () => {
  it("one scope per department, valid under the framework's own checks", () => {
    for (const d of FIRM_SERVICES) {
      expect(COMMS_SCOPES[d].scope?.department).toBe(d);
      expect(validateScope(COMMS_SCOPES[d])).toEqual([]);
    }
  });

  it("names are comms.<task>.<department>, version 1, with a tier hint", () => {
    const names = allSpecs().map(({ s }) => `${s.name}@${s.version}`);
    expect(new Set(names).size).toBe(names.length);
    for (const { s } of allSpecs()) {
      expect(s.name).toMatch(/^comms\.(polish|translate)\.(gst|roc|incometax|tds|books|audit|engagement)$/);
      expect(s.version).toBe(1);
      expect(s.difficulty).toBeDefined();
      expect(typeof s.validate).toBe("function");
    }
  });

  it("closed outputs: every string capped at 300 or less, and the model may abstain", () => {
    for (const { s } of allSpecs()) {
      expect(unboundedStrings(s.schema as ZodTypeAny), s.name).toEqual([]);
      expect(hasAbstainOption(s.schema as ZodTypeAny), s.name).toBe(true);
    }
  });

  it("system prompt = FIRM_PREAMBLE + department preamble + comms preamble + task", () => {
    for (const { d, s } of allSpecs()) {
      const prompt = composeSystemPrompt(d, s);
      expect(prompt.startsWith(FIRM_PREAMBLE)).toBe(true);
      expect(prompt).toContain(departmentPreamble(d));
      expect(prompt).toContain(COMMS_PREAMBLE);
      expect(prompt).toMatch(/never send/i);
    }
  });
});

describe("prompt lock", () => {
  it("every comms task is in prompts.lock.json with its current hash", () => {
    const lock = parsePromptLock(readFileSync(PROMPT_LOCK_FILE, "utf8"));
    const check = verifyPromptLock(lock, currentPrompts(COMMS_PROMPT_OWNERS));
    expect(check.problems).toEqual([]);
    expect(currentPrompts(COMMS_PROMPT_OWNERS).length).toBe(allSpecs().length);
  });

  it("the task agents' entries are unchanged alongside them", () => {
    const lock = parsePromptLock(readFileSync(PROMPT_LOCK_FILE, "utf8"));
    expect(verifyPromptLock(lock, currentPrompts({ ...AGENTS, ...COMMS_PROMPT_OWNERS })).problems).toEqual([]);
    expect(lock.prompts["gst.classify-ledgers@1"]).toBe("b7e7cddba3a0515a3aed66e7c1adf50b7d2c72458ba8434ed5c192d908de9513");
  });
});

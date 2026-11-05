import { describe, it, expect } from "vitest";
import * as core from "./index";

describe("agent core barrel", () => {
  it("exposes the public surface", () => {
    for (const name of ["canTransition", "nextStates", "transitionJobTask", "runChecklist", "loadRuleSet", "buildWorkbook", "buildDocx", "formatInr", "dueDatesFor", "packDueDates"]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    }
    expect(core.DEFAULT_CALENDAR.rules.length).toBeGreaterThan(10);
    expect(core.DRAFT_LABEL).toBe("Draft — prepared for human review; not for filing");
  });

  it("does not expose the close-gate minter or token consumption", () => {
    const names = Object.keys(core);
    expect(names.some((n) => /gate/i.test(n) && /register|mint|consume/i.test(n))).toBe(false);
  });
});

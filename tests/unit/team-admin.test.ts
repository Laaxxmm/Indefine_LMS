// Security audit finding D: an LMS admin could set their own level to PARTNER in /admin/team
// (only the role was protected), gaining partner rights across the LMS and Firm OS. The save now
// drops role and level from the admin's own row; other people's rows are unchanged.
import { describe, expect, it } from "vitest";
import { SELF_LOCKED_FIELDS, stripSelfAccessEdits } from "@/lib/team-admin";

describe("stripSelfAccessEdits", () => {
  it("drops role and level from the acting admin's own row, keeps their other fields and everyone else's changes", () => {
    const updates = new Map<string, Record<string, unknown>>([
      ["u-me", { role: "EMPLOYEE", level: "PARTNER", department: "TAX", managerId: null, excludedFromScoring: false }],
      ["u-other", { role: "ADMIN", level: "PARTNER", department: "AUDIT" }],
    ]);
    expect(stripSelfAccessEdits(updates, "u-me")).toEqual(["role", "level"]);
    expect(updates.get("u-me")).toEqual({ department: "TAX", managerId: null, excludedFromScoring: false });
    expect(updates.get("u-other")).toEqual({ role: "ADMIN", level: "PARTNER", department: "AUDIT" }); // another admin may promote
  });

  it("does nothing when the admin's own row is not in the submission or carries neither field", () => {
    const updates = new Map<string, Record<string, unknown>>([["u-other", { level: "MANAGER" }]]);
    expect(stripSelfAccessEdits(updates, "u-me")).toEqual([]);
    const own = new Map<string, Record<string, unknown>>([["u-me", { department: "TAX" }]]);
    expect(stripSelfAccessEdits(own, "u-me")).toEqual([]);
    expect(own.get("u-me")).toEqual({ department: "TAX" });
    expect([...SELF_LOCKED_FIELDS]).toEqual(["role", "level"]);
  });
});

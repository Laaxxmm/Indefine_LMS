import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/access";
import { ENTRA_GROUP_ROLES, FIRM_ROLE_LABELS, canOnboard, firmRole, roleFromEntraGroups } from "./policy";

const u = (o: { role?: string; level?: string; active?: boolean } = {}): SessionUser =>
  ({ id: "x", role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: true, ...o }) as unknown as SessionUser;

describe("firmRole", () => {
  it.each([
    [{ role: "ADMIN" }, "admin"],
    [{ role: "ADMIN", level: "PARTNER" }, "admin"],
    [{ level: "PARTNER" }, "partner"],
    [{ level: "MANAGER" }, "manager"],
    [{ level: "SENIOR_MANAGER" }, "manager"],
    [{ level: "ASSISTANT_MANAGER" }, "staff"],
    [{ level: "SENIOR_EXECUTIVE" }, "staff"],
    [{ level: "ARTICLE" }, "staff"],
    [{ level: "LEAD" }, "staff"],
    [{}, "staff"],
  ])("%o → %s", (o, role) => {
    expect(firmRole(u(o))).toBe(role);
  });

  it("treats a missing session as staff", () => {
    expect(firmRole(null)).toBe("staff");
    expect(firmRole(undefined)).toBe("staff");
  });

  it("has a label for every role", () => {
    expect(Object.keys(FIRM_ROLE_LABELS).sort()).toEqual(["admin", "manager", "partner", "staff"]);
  });
});

describe("canOnboard", () => {
  it("allows partners, managers and admins", () => {
    expect(canOnboard(u({ level: "PARTNER" }))).toBe(true);
    expect(canOnboard(u({ level: "MANAGER" }))).toBe(true);
    expect(canOnboard(u({ level: "SENIOR_MANAGER" }))).toBe(true);
    expect(canOnboard(u({ role: "ADMIN" }))).toBe(true);
  });

  it("refuses staff, deactivated users and signed-out visitors", () => {
    expect(canOnboard(u())).toBe(false);
    expect(canOnboard(u({ level: "ASSISTANT_MANAGER" }))).toBe(false);
    expect(canOnboard(u({ level: "PARTNER", active: false }))).toBe(false);
    expect(canOnboard(null)).toBe(false);
  });
});

describe("Entra group hook (not wired yet)", () => {
  it("maps the Partners and Staff groups", () => {
    expect(roleFromEntraGroups(["67ed1191-302b-495a-913b-b93cc6ee118d"])).toBe("staff");
    expect(roleFromEntraGroups(["67ed1191-302b-495a-913b-b93cc6ee118d", "E5583268-4C8C-4ABF-8B35-3EF1F0D37A78"])).toBe("partner");
    expect(roleFromEntraGroups(["e5583268-4c8c-4abf-8b35-3ef1f0d37a78", "67ed1191-302b-495a-913b-b93cc6ee118d"])).toBe("partner");
  });

  it("returns null for unknown or missing groups", () => {
    expect(roleFromEntraGroups(["00000000-0000-0000-0000-000000000000"])).toBeNull();
    expect(roleFromEntraGroups([])).toBeNull();
    expect(roleFromEntraGroups(undefined)).toBeNull();
    expect(Object.keys(ENTRA_GROUP_ROLES)).toHaveLength(2);
  });
});

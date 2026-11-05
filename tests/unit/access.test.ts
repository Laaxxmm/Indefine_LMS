import { describe, expect, it } from "vitest";
import { isActive, isAdmin, isManagement, isPartner, type SessionUser } from "@/lib/access";

const u = (o: { role?: string; level?: string; active?: boolean }): SessionUser =>
  ({ id: "x", role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: true, ...o }) as unknown as SessionUser;

describe("access predicates (baseline LMS)", () => {
  it("isActive", () => {
    expect(isActive(u({ active: true }))).toBe(true);
    expect(isActive(u({ active: false }))).toBe(false);
    expect(isActive(null)).toBe(false);
  });
  it("isAdmin / isPartner / isManagement", () => {
    expect(isAdmin(u({ role: "ADMIN" }))).toBe(true);
    expect(isPartner(u({ level: "PARTNER" }))).toBe(true);
    expect(isManagement(u({ level: "PARTNER" }))).toBe(true);
    expect(isManagement(u({ level: "MANAGER" }))).toBe(false);
  });
});

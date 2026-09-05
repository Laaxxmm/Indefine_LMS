import assert from "node:assert/strict";
import { isActive, isAdmin, isManagement, isPartner } from "../src/lib/access";

// Shape of session.user as declared in src/types/next-auth.d.ts. Only the fields the
// predicates read are set; the cast keeps the script honest about that.
type U = Parameters<typeof isActive>[0];
const u = (o: { role?: string; level?: string; active?: boolean }): U =>
  ({ id: "x", role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: true, ...o }) as unknown as U;

assert.equal(isActive(u({ active: true })), true);
assert.equal(isActive(u({ active: false })), false);
assert.equal(isActive(undefined), false);
assert.equal(isActive(null), false);

assert.equal(isAdmin(u({ role: "ADMIN" })), true);
assert.equal(isAdmin(u({ role: "ADMIN", active: false })), true); // admin is a role check only; pair with isActive where needed
assert.equal(isAdmin(u({ role: "EMPLOYEE" })), false);
assert.equal(isAdmin(null), false);

assert.equal(isPartner(u({ level: "PARTNER" })), true);
assert.equal(isPartner(u({ level: "MANAGER" })), false);
assert.equal(isPartner(undefined), false);

assert.equal(isManagement(u({ role: "ADMIN" })), true);
assert.equal(isManagement(u({ level: "PARTNER" })), true);
assert.equal(isManagement(u({ role: "EMPLOYEE", level: "MANAGER" })), false);

console.log("verify-access: all checks passed");

import assert from "node:assert/strict";
import {
  turnoverBand, safeName, folderName, fyFor, fyOptions, isValidFy, PAN_RE, GSTIN_RE,
  clientBodyZ, jobBodyZ, SEED_SERVICES, isKycDocType, canManageClients, canViewClients,
} from "../src/lib/clients/core";

// Turnover bands (rupees). Boundaries are inclusive on the upper band.
assert.equal(turnoverBand(0), "UNDER_40L");
assert.equal(turnoverBand(3_999_999), "UNDER_40L");
assert.equal(turnoverBand(4_000_000), "L40_TO_1CR");
assert.equal(turnoverBand(9_999_999), "L40_TO_1CR");
assert.equal(turnoverBand(10_000_000), "CR1_TO_5CR");
assert.equal(turnoverBand(49_999_999), "CR1_TO_5CR");
assert.equal(turnoverBand(50_000_000), "CR5_TO_20CR");
assert.equal(turnoverBand(199_999_999), "CR5_TO_20CR");
assert.equal(turnoverBand(200_000_000), "ABOVE_20CR");

// Names safe for SharePoint.
assert.equal(safeName('Acme / Sons: "Pvt" <Ltd>?'), "Acme - Sons- -Pvt- -Ltd-");
assert.equal(safeName("  a   b  "), "a b");
assert.equal(folderName("x".repeat(100)).length, 80);
assert.equal(folderName("///"), "-");

// Indian FY.
assert.equal(fyFor(new Date(2026, 8, 2)), "2026-27"); // Sep 2026
assert.equal(fyFor(new Date(2026, 2, 31)), "2025-26"); // Mar 2026
assert.equal(fyFor(new Date(2026, 3, 1)), "2026-27"); // Apr 2026
assert.deepEqual(fyOptions(new Date(2026, 8, 2)), ["2026-27", "2025-26", "2024-25", "2023-24"]);
assert.equal(fyFor(new Date(2099, 5, 1)), "2099-00");
assert.ok(isValidFy("2026-27"));
assert.ok(isValidFy("2099-00"));
assert.ok(!isValidFy("2026-28"));
assert.ok(!isValidFy("26-27"));

// Identifiers.
assert.ok(PAN_RE.test("ABCDE1234F"));
assert.ok(!PAN_RE.test("ABCD1234F"));
assert.ok(GSTIN_RE.test("33ABCDE1234F1Z5"));
assert.ok(!GSTIN_RE.test("33ABCDE1234F1Y5"));

// zod: empties become undefined, PAN upper-cased, turnover coerced.
const c = clientBodyZ.safeParse({
  name: "Test Client", entityType: "PVT_LTD", pan: " abcde1234f ", gstin: "", cin: "", city: "Chennai",
  contactPhone: "", contactEmail: "", turnover: "1500000", growthGoal: "MAINTAIN", growthNote: "",
  onboardedOn: "2026-09-02", primaryHandlerId: "u1",
});
assert.ok(c.success, JSON.stringify(c.success ? null : c.error.issues));
if (c.success) {
  assert.equal(c.data.pan, "ABCDE1234F");
  assert.equal(c.data.gstin, undefined);
  assert.equal(c.data.turnover, 1500000);
  assert.equal(c.data.growthNote, undefined);
  assert.ok(c.data.onboardedOn instanceof Date);
}
assert.ok(!clientBodyZ.safeParse({ name: "X", entityType: "PVT_LTD", turnover: -1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);
assert.ok(!clientBodyZ.safeParse({ name: "Test", entityType: "PVT_LTD", pan: "BAD", turnover: 1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);
assert.ok(!clientBodyZ.safeParse({ name: "Test", entityType: "PVT_LTD", contactPhone: "12345", turnover: 1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);

const j = jobBodyZ.safeParse({ serviceTypeId: "s1", fy: "2026-27", handlerId: "u1", dueOn: "", fees: "" });
assert.ok(j.success);
if (j.success) { assert.equal(j.data.status, "NOT_STARTED"); assert.equal(j.data.dueOn, undefined); assert.equal(j.data.fees, undefined); }
assert.ok(!jobBodyZ.safeParse({ serviceTypeId: "s1", fy: "2026-28", handlerId: "u1" }).success);

// Seed list: every entry is a known department, no duplicate names within a department.
for (const [dept, names] of SEED_SERVICES) {
  assert.ok(["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN"].includes(dept), dept);
  assert.equal(new Set(names).size, names.length, `duplicate service under ${dept}`);
}
// Brief's assertion said 27; the verbatim SEED_SERVICES list below sums to 26
// (5+8+4+6+2+1). Counting the actual data rather than guessing a 27th service.
assert.equal(SEED_SERVICES.flatMap(([, n]) => n).length, 26);

// Doc type split.
assert.ok(isKycDocType("PAN"));
assert.ok(!isKycDocType("WORKING_PAPERS"));

// Access.
const base = { id: "u", active: true, role: "EMPLOYEE" as const, department: "TAX", level: "EXECUTIVE", email: "e@x", name: "n" };
assert.ok(canViewClients(base));
assert.ok(!canViewClients({ ...base, active: false }));
assert.ok(!canManageClients(base));
assert.ok(canManageClients({ ...base, role: "ADMIN" }));
assert.ok(canManageClients({ ...base, level: "PARTNER" }));
assert.ok(!canManageClients({ ...base, level: "PARTNER", active: false }));

console.log("verify-clients: core OK");

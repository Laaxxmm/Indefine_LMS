import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  turnoverBand, safeName, folderName, fyFor, fyOptions, isValidFy, PAN_RE, GSTIN_RE,
  clientBodyZ, jobBodyZ, SEED_SERVICES, isKycDocType, canManageClients, canViewClients,
} from "../src/lib/clients/core";
import { buildClientWorkbook, istMonth, istDate, type WorkbookInput } from "../src/lib/clients/workbook";

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

(async () => {
  // Workbook builder — pure, no DB.
  assert.equal(istMonth(new Date("2026-03-31T20:00:00Z")), "2026-04"); // 01:30 IST next day
  assert.equal(istDate(new Date("2026-03-31T20:00:00Z")), "2026-04-01");

  const input: WorkbookInput = {
    clients: [{
      name: "Alpha Traders", entityType: "PROPRIETORSHIP", pan: "ABCDE1234F", gstin: null, cin: null, industry: "Retail", city: "Chennai",
      contactName: "A", contactPhone: "9999999999", contactEmail: null, referralSource: null, turnover: 2_500_000, turnoverBand: "UNDER_40L",
      growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-09-01T00:00:00Z"), handler: "H One", active: true,
      jobCount: 1, lastJobOn: new Date("2026-09-01T00:00:00Z"), folderStatus: "READY",
    }],
    jobs: [{
      client: "Alpha Traders", fy: "2026-27", department: "TAX", service: "ITR filing", handler: "H One", status: "IN_PROGRESS",
      dueOn: null, fees: 5000, turnoverBand: "UNDER_40L", growthGoal: "MAINTAIN", entityType: "PROPRIETORSHIP", city: "Chennai",
      createdAt: new Date("2026-09-01T00:00:00Z"), createdBy: "H One",
    }],
    documents: [{ client: "Alpha Traders", job: "2026-27 · ITR filing", docType: "PAN", name: "PAN - card.pdf", uploadedBy: "H One", createdAt: new Date("2026-09-01T00:00:00Z"), webUrl: "https://example.sharepoint.com/x" }],
  };
  const wb = buildClientWorkbook(input);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Clients", "Jobs", "Documents"]);
  const jobs = wb.getWorksheet("Jobs")!;
  assert.equal(jobs.getCell("A2").value, "Client");
  assert.equal(jobs.getCell("A3").value, "Alpha Traders");
  assert.equal(jobs.getCell("C3").value, "2026-09"); // Month
  assert.equal(jobs.getCell("D3").value, "Tax");
  assert.equal(jobs.getCell("G3").value, "In progress");
  assert.equal(wb.getWorksheet("Clients")!.getCell("M3").value, "Under ₹40 L");
  assert.equal(wb.getWorksheet("Documents")!.getCell("G3").value, "https://example.sharepoint.com/x");
  // Round-trips through xlsx (catches invalid table definitions).
  const bytes = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(bytes);
  assert.equal(back.getWorksheet("Jobs")!.rowCount, 3);

  console.log("verify-clients: core + workbook OK");
})().catch((e) => { console.error(e); process.exit(1); });

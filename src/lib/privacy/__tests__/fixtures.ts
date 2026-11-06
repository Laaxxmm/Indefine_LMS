// Shared synthetic world for the corrections and privacy tests. No real client data: every PAN,
// GSTIN, phone and email below is made up (GSTINs carry a valid checksum so the validators pass).
import type { Session } from "next-auth";
import { gstinCheckChar } from "@/lib/ai/anonymizer";
import { createMemoryDb, type MemoryDb } from "./memory-db";

export type TestUser = Session["user"];

export function sessionUser(id: string, overrides: Partial<TestUser> = {}): TestUser {
  return { id, name: id, email: `${id}@indefine.test`, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "EXECUTIVE", ...overrides };
}

export const USERS = {
  admin: sessionUser("u-admin", { role: "ADMIN", name: "Asha Admin" }),
  partner: sessionUser("u-partner", { level: "PARTNER", name: "Lakshmi Partner" }),
  manager: sessionUser("u-manager", { level: "MANAGER", name: "Mohan Manager" }),
  otherManager: sessionUser("u-manager2", { level: "MANAGER", name: "Meera Manager" }),
  staff: sessionUser("u-staff", { name: "Priya Staff" }),
  reviewer: sessionUser("u-reviewer", { name: "Ravi Reviewer" }),
  inactive: sessionUser("u-gone", { active: false, role: "ADMIN" }),
};

/** A GSTIN with a valid check character for the given state code and PAN. */
export const gstinFor = (state: string, pan: string, entity = "1") => {
  const first14 = `${state}${pan}${entity}Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

export const PAN_PROP = "ABCPK1234F"; // 4th char P: individual / proprietor
export const PAN_CO = "AAACZ9876Q"; // 4th char C: company
export const PAN_OTHER = "BCDPL4321M";

export const T0 = new Date("2026-11-05T05:30:00.000Z"); // 05 Nov 2026 11:00 IST

export function seedWorld(db: MemoryDb) {
  db.seed("user", [
    { id: USERS.admin.id, name: "Asha Admin", email: "asha@indefine.test", active: true, excludedFromScoring: false, managerId: null },
    { id: USERS.partner.id, name: "Lakshmi Partner", email: "lakshmi@indefine.test", active: true, excludedFromScoring: false, managerId: null },
    { id: USERS.manager.id, name: "Mohan Manager", email: "mohan@indefine.test", active: true, excludedFromScoring: false, managerId: USERS.partner.id },
    { id: USERS.otherManager.id, name: "Meera Manager", email: "meera@indefine.test", active: true, excludedFromScoring: false, managerId: USERS.partner.id },
    { id: USERS.staff.id, name: "Priya Staff", email: "priya@indefine.test", active: true, excludedFromScoring: false, managerId: USERS.manager.id },
    { id: USERS.reviewer.id, name: "Ravi Reviewer", email: "ravi@indefine.test", active: true, excludedFromScoring: false, managerId: USERS.otherManager.id },
    { id: "u-mailbox", name: "Accounts Mailbox", email: "accounts@indefine.test", active: true, excludedFromScoring: true, managerId: null },
    { id: "u-left", name: "Former Staff", email: "former@indefine.test", active: false, excludedFromScoring: false, managerId: null },
  ]);
  db.seed("client", [
    {
      id: "c-prop",
      name: "Kumar Traders",
      folderName: "Kumar Traders",
      entityType: "PROPRIETORSHIP",
      pan: PAN_PROP,
      gstin: gstinFor("29", PAN_PROP),
      cin: null,
      industry: "Retail",
      city: "Bengaluru",
      contactName: "Kiran Kumar",
      contactPhone: "9876543210",
      contactEmail: "kiran@kumartraders.test",
      referralSource: "Referred by an existing client",
      turnover: 3_500_000,
      turnoverBand: "UNDER_40L",
      growthGoal: "MAINTAIN",
      growthNote: "Wants to open a second shop",
      onboardedOn: new Date("2024-04-01T00:00:00.000Z"),
      primaryHandlerId: USERS.staff.id,
      active: true,
      graphFolderId: "drive-item-1",
      folderStatus: "READY",
      createdById: USERS.partner.id,
    },
    {
      id: "c-co",
      name: "Zenith Components Pvt Ltd",
      folderName: "Zenith Components Pvt Ltd",
      entityType: "PVT_LTD",
      pan: PAN_CO,
      gstin: gstinFor("29", PAN_CO),
      cin: "U12345KA2020PTC123456",
      industry: "Manufacturing",
      city: "Mysuru",
      contactName: "Zara Iyer",
      contactPhone: "9123456780",
      contactEmail: "zara@zenith.test",
      referralSource: null,
      turnover: 120_000_000,
      turnoverBand: "ABOVE_20CR",
      growthGoal: "EXPORT",
      growthNote: null,
      onboardedOn: new Date("2023-06-01T00:00:00.000Z"),
      primaryHandlerId: USERS.staff.id,
      active: true,
      graphFolderId: null,
      folderStatus: "PENDING",
      createdById: USERS.partner.id,
    },
    {
      id: "c-prospect",
      name: "Lalitha Consulting",
      folderName: "Lalitha Consulting",
      entityType: "INDIVIDUAL",
      pan: PAN_OTHER,
      gstin: null,
      cin: null,
      industry: null,
      city: "Chennai",
      contactName: "Lalitha L",
      contactPhone: "9000012345",
      contactEmail: "lalitha@consult.test",
      referralSource: "Website",
      turnover: 0,
      turnoverBand: "UNDER_40L",
      growthGoal: "OTHER",
      growthNote: "Asked for a quote only",
      onboardedOn: new Date("2026-10-01T00:00:00.000Z"),
      primaryHandlerId: USERS.staff.id,
      active: true,
      graphFolderId: null,
      folderStatus: "PENDING",
      createdById: USERS.partner.id,
    },
  ]);
  db.seed("firmClient", [
    { id: "fc-prop", lmsClientId: "c-prop", clientCode: "KUMAR1", turiaClientRef: "T-100", clSiteUrl: null, preferredLanguage: "en", createdById: USERS.partner.id },
    { id: "fc-co", lmsClientId: "c-co", clientCode: "ZENITH", turiaClientRef: "T-200", clSiteUrl: "https://example.sharepoint.test/sites/CL-ZENITH", preferredLanguage: "kn", createdById: USERS.partner.id },
  ]);
  db.seed("engagement", [
    { id: "e-gst", firmClientId: "fc-prop", service: "GST", frequency: "MONTHLY", assigneeId: USERS.staff.id, reviewerId: USERS.reviewer.id, active: true },
    { id: "e-roc", firmClientId: "fc-co", service: "ROC", frequency: "ANNUAL", assigneeId: USERS.reviewer.id, reviewerId: USERS.staff.id, active: true },
  ]);
  db.seed("jobTask", [
    {
      id: "j-assigned",
      firmClientId: "fc-prop",
      engagementId: "e-gst",
      service: "GST",
      fy: "2026-27",
      period: "2026-10",
      title: "GSTR-3B",
      state: "ASSIGNED",
      assigneeId: USERS.staff.id,
      reviewerId: USERS.reviewer.id,
      statutoryDueOn: new Date("2026-11-19T18:30:00.000Z"), // 20 Nov 2026 IST
      internalDueOn: new Date("2026-11-16T18:30:00.000Z"), // 17 Nov 2026 IST
      ackRef: null,
      createdById: USERS.partner.id,
    },
    {
      id: "j-prep",
      firmClientId: "fc-prop",
      engagementId: "e-gst",
      service: "GST",
      fy: "2026-27",
      period: "2026-09",
      title: "GSTR-3B",
      state: "IN_PREP",
      assigneeId: USERS.staff.id,
      reviewerId: USERS.reviewer.id,
      statutoryDueOn: new Date("2026-10-19T18:30:00.000Z"),
      internalDueOn: new Date("2026-10-16T18:30:00.000Z"),
      ackRef: null,
      createdById: USERS.partner.id,
    },
    {
      id: "j-done",
      firmClientId: "fc-co",
      engagementId: "e-roc",
      service: "ROC",
      fy: "2025-26",
      period: "Annual",
      title: "AOC-4",
      state: "DONE",
      assigneeId: USERS.reviewer.id,
      reviewerId: USERS.staff.id,
      statutoryDueOn: new Date("2026-10-29T18:30:00.000Z"),
      internalDueOn: new Date("2026-10-26T18:30:00.000Z"),
      ackRef: "SRN-AB1234567",
      createdById: USERS.partner.id,
    },
  ]);
  db.seed("commsDraft", [
    { id: "d-new", firmClientId: "fc-prop", jobTaskId: "j-assigned", kind: "doc-chase", language: "en", subject: "Documents for October GST", body: "Dear Kiran, please share the October sales register.", createdById: USERS.staff.id, outlookDraftId: null },
    { id: "d-opened", firmClientId: "fc-prop", jobTaskId: "j-assigned", kind: "status", language: "en", subject: "Status", body: "Your return is in progress.", createdById: USERS.staff.id, outlookDraftId: "outlook-123" },
  ]);
}

export function world(now: () => Date = () => T0): MemoryDb {
  const db = createMemoryDb({ now });
  seedWorld(db);
  return db;
}

export const SUPPLIER_PAN = "CDEPS7777K"; // a supplier named in Kumar Traders' purchase register
export const ZENITH_SIGNATORY = "zara.signatory@zenith.test";

/** Extra records for the privacy tests: documents, runs, certificates, an old client. */
export function privacyWorld(now: () => Date = () => T0): MemoryDb {
  const db = world(now);
  db.seed("client", [
    {
      id: "c-old",
      name: "Old Ledger Accounts",
      folderName: "Old Ledger Accounts",
      entityType: "INDIVIDUAL",
      pan: "DEFPO1111A",
      gstin: null,
      cin: null,
      industry: "Services",
      city: "Pune",
      contactName: "Omkar O",
      contactPhone: "9333344444",
      contactEmail: "omkar@oldledger.test",
      referralSource: null,
      turnover: 1_200_000,
      turnoverBand: "UNDER_40L",
      growthGoal: "MAINTAIN",
      growthNote: null,
      onboardedOn: new Date("2015-05-01T00:00:00.000Z"),
      primaryHandlerId: USERS.staff.id,
      active: false,
      graphFolderId: null,
      folderStatus: "PENDING",
      createdById: USERS.partner.id,
    },
  ]);
  db.seed("firmClient", [{ id: "fc-old", lmsClientId: "c-old", clientCode: "OLDLED", turiaClientRef: null, clSiteUrl: null, preferredLanguage: "en", createdById: USERS.partner.id }]);
  db.seed("jobTask", [
    {
      id: "j-old",
      firmClientId: "fc-old",
      engagementId: null,
      service: "IncomeTax",
      fy: "2015-16",
      period: "Annual",
      title: "ITR",
      state: "DONE",
      assigneeId: USERS.staff.id,
      reviewerId: USERS.reviewer.id,
      statutoryDueOn: null,
      internalDueOn: null,
      ackRef: "ITR-ACK-123456789",
      createdById: USERS.partner.id,
    },
  ]);
  db.seed("job", [
    { id: "lj-prop", clientId: "c-prop", serviceTypeId: "st-gst", fy: "2025-26", handlerId: USERS.staff.id, status: "CLOSED", dueOn: null, fees: 24000, notes: "Kiran prefers WhatsApp", createdById: USERS.partner.id },
    { id: "lj-co", clientId: "c-co", serviceTypeId: "st-roc", fy: "2025-26", handlerId: USERS.staff.id, status: "IN_PROGRESS", dueOn: null, fees: 50000, notes: "Zenith board meets in October", createdById: USERS.partner.id },
  ]);
  db.seed("onboardingRun", [
    { id: "ob-prop", createdById: USERS.partner.id, prompt: "Onboard Kumar Traders, PAN ABCPK1234F, GST monthly, assign Priya", spec: { legalName: "Kumar Traders", pan: PAN_PROP }, plan: { jobs: 12 }, status: "DONE", steps: null, error: null, firmClientId: "fc-prop" },
    { id: "ob-co", createdById: USERS.partner.id, prompt: "Onboard Zenith Components", spec: { legalName: "Zenith Components Pvt Ltd", pan: PAN_CO, contactName: "Zara Iyer", contactEmail: "zara@zenith.test" }, plan: null, status: "DONE", steps: null, error: null, firmClientId: "fc-co" },
  ]);
  db.seed("agentRun", [
    { id: "run-prop", jobTaskId: "j-prep", agent: "gst", sopPackVersion: "1.0.0", status: "AGENT_DONE", attempt: 1, inputs: { purchases: [{ supplierPan: SUPPLIER_PAN, amount: 1180 }] }, inputsPurgeAt: new Date("2026-11-30T00:00:00.000Z"), figures: { outputTax: 1800 }, startedAt: T0 },
  ]);
  db.seed("deliverable", [
    { id: "dl-prop", jobTaskId: "j-prep", agentRunId: "run-prop", kind: "Working", name: "GSTR-3B_2026-09.xlsx", spPath: "CL-KUMAR1/Compliance/FY2026-27/GST/2026-09/Working/GSTR-3B_2026-09.xlsx", sha256: "abc", sizeBytes: 100, version: 1 },
  ]);
  db.seed("clientDocument", [
    { id: "doc-prop", clientId: "c-prop", jobId: null, docType: "PAN", name: "PAN card.pdf", graphDriveId: "d", graphItemId: "i1", webUrl: "https://example.sharepoint.test/pan.pdf", sizeBytes: 10, uploadedById: USERS.staff.id },
    { id: "doc-co", clientId: "c-co", jobId: null, docType: "PAN", name: "Zenith PAN.pdf", graphDriveId: "d", graphItemId: "i2", webUrl: "https://example.sharepoint.test/zpan.pdf", sizeBytes: 10, uploadedById: USERS.staff.id },
  ]);
  db.seed("certificateIssue", [
    { id: "cert-prop", formatId: "i-ufce", formatTitle: "Net worth certificate", templateVersion: "1", templateHash: "h", clientName: "Kumar Traders", clientId: "c-prop", payload: { pan: PAN_PROP, netWorth: 1500000 }, acknowledged: false, createdById: USERS.partner.id },
    { id: "cert-co", formatId: "i-ufce", formatTitle: "Turnover certificate", templateVersion: "1", templateHash: "h", clientName: "Zenith Components Pvt Ltd", clientId: "c-co", payload: { pan: PAN_CO }, acknowledged: false, createdById: USERS.partner.id },
  ]);
  db.seed("engagementLetter", [
    { id: "el-co", clientName: "Zenith Components Pvt Ltd", clientId: "c-co", fy: "26-27", data: { signatory: "Zara Iyer" }, status: "SENT", sentTo: ZENITH_SIGNATORY, createdById: USERS.partner.id, createdByName: "Lakshmi", updatedByName: "Lakshmi" },
  ]);
  db.seed("attendanceRecord", [
    { id: "att-1", userId: USERS.staff.id, periodMonth: new Date("2026-10-01T00:00:00.000Z"), workingDays: 22, presentDays: 21, lateMarks: 1, attendancePct: 95.45, points: 9, source: "greytHR" },
    { id: "att-2", userId: USERS.reviewer.id, periodMonth: new Date("2026-10-01T00:00:00.000Z"), workingDays: 22, presentDays: 20, lateMarks: 0, attendancePct: 90.9, points: 8, source: "greytHR" },
  ]);
  return db;
}

// Erasure covers every column that can carry a person's identifiers (DPDP audit finding #5, ported
// from the audit PoC .audit-sec/dpdp/erasure-survivors.test.ts). A confirmed erasure of a client
// whose duties have all run out leaves none of their names or identifiers anywhere in the
// database, with UPDATEs only: row ids, figures and the shape of audit rows stay.
import { describe, expect, it } from "vitest";
import { confirmErasure, planErasure, type ErasurePlan } from "./erasure";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import { PAN_PROP, T0, USERS, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";
import { ERASED_CLIENT_NOTE, erasedClientKey } from "@/lib/integrations/turia/pull/erased";

type Row = Record<string, unknown>;
const KEY = "k";
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: KEY });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const find = (db: MemoryDb, model: string, id: string) => db.tables[model].find((r) => r.id === id) as Row;

const PAN = "DEFPO1111A"; // c-old "Old Ledger Accounts" (every retention duty has run out at T0)
const NAME = "Old Ledger Accounts";
const CONTACT = "Omkar O";
const EMAIL = "omkar@oldledger.test";
const PHONE = "9333344444";
const NEEDLES = { PAN, NAME, CONTACT, EMAIL, PHONE };

/** Copies of the old client's data in the columns real Firm OS code writes (writers cited in the audit report). */
function seedShadowCopies(db: MemoryDb) {
  db.seed("auditEvent", [
    { id: "ae-comment", actorId: USERS.staff.id, action: "comment", entity: "AgentRun", entityId: "run-old", meta: { text: `${CONTACT} says the PAN ${PAN} on the ITR is wrong` } },
    { id: "ae-approve", actorId: USERS.staff.id, action: "approve", entity: "JobTask", entityId: "j-old", meta: { from: "IN_REVIEW", to: "APPROVED", note: `Checked with ${CONTACT} on ${PHONE}` } },
  ]);
  db.seed("agentRun", [
    { id: "run-old", jobTaskId: "j-old", agent: "tax", sopPackVersion: "1.0.0", status: "APPROVED", attempt: 1, inputs: null, inputsPurgeAt: null, figures: { assessee: NAME, pan: PAN, totalIncome: 1200000 }, reviewNotes: `Call ${CONTACT} at ${PHONE}`, startedAt: new Date("2016-06-01T00:00:00.000Z") },
  ]);
  db.seed("checklistResult", [{ id: "cr-old", agentRunId: "run-old", ruleId: "tax.pan", severity: "block", status: "fail", message: `PAN ${PAN} does not match 26AS`, evidence: { quote: `${NAME} ${PAN}`, location: "26AS p1" }, source: "deterministic" }]);
  db.seed("deliverable", [{ id: "dl-old", jobTaskId: "j-old", agentRunId: "run-old", kind: "Final", name: `OLDLED_ITR_${PAN}_v1.pdf`, spPath: `CL-OLDLED/Compliance/FY2015-16/IncomeTax/Annual/Final/OLDLED_ITR_${PAN}_v1.pdf`, driveItemId: "item-9", sha256: "x", sizeBytes: 1, version: 1 }]);
  db.seed("jobTaskEvent", [{ id: "jte-old", jobTaskId: "j-old", fromState: "FILED_BY_HUMAN", toState: "DONE", actorId: USERS.staff.id, note: `Ack ITR-ACK-123456789 for ${NAME} (${PAN})` }]);
  db.seed("turiaSync", [{ id: "ts-old", jobTaskId: "j-old", firmClientId: "fc-old", operation: "createClient", mode: "MANUAL", status: "CONFIRMED", turiaRef: "T-OLD", minutesLogged: 30, evidence: { key: "k-old", checklist: [`Type client name: ${NAME}`, `Type PAN: ${PAN}`, `Contact: ${CONTACT} ${PHONE} ${EMAIL}`] } }]);
  db.seed("mistakeLog", [{ id: "ml-old", agent: "tax", pattern: "missed 26AS mismatch", ruleProposal: { id: "tax.26as" }, example: { runId: "run-old", extracted: { assessee: NAME, pan: PAN } }, agentRunId: "run-old", status: "APPROVED", createdById: USERS.staff.id }]);
  db.seed("coachEvent", [{ id: "ce-old", userId: USERS.staff.id, kind: "reminder", jobTaskId: "j-old", payload: { label: "ITR Annual for OLDLED", clientName: NAME }, dedupeKey: "reminder:j-old:u-staff:2016-07-01" }]);
  db.seed("commsDraft", [
    { id: "d-old", firmClientId: "fc-old", jobTaskId: "j-old", kind: "status", language: "en", subject: `ITR for ${NAME}`, body: `Dear ${CONTACT}, PAN ${PAN} …`, createdById: USERS.staff.id, outlookDraftId: null },
    // Not tied to a job.
    { id: "d-old-nojob", firmClientId: "fc-old", jobTaskId: null, kind: "doc-chase", language: "en", subject: `Documents, ${NAME}`, body: `Dear ${CONTACT}, call ${PHONE}`, createdById: USERS.staff.id, outlookDraftId: null },
  ]);
  // A failed onboarding run never linked to a FirmClient (the saga failed before createOrLinkClient).
  db.seed("onboardingRun", [{ id: "ob-old-failed", createdById: USERS.partner.id, prompt: `Onboard ${NAME}, PAN ${PAN}, contact ${CONTACT} ${PHONE}`, spec: { legalName: NAME, pan: PAN, contactName: CONTACT, contactPhone: PHONE, contactEmail: EMAIL }, plan: null, status: "FAILED", steps: null, error: "site creation failed", firmClientId: null }]);
  db.seed("certificateIssue", [{ id: "cert-old", formatId: "i-ufce", formatTitle: "Net worth", templateVersion: "1", templateHash: "h", clientName: NAME, clientId: "c-old", payload: { pan: PAN }, acknowledged: false, createdById: USERS.partner.id, createdAt: new Date("2016-05-01T00:00:00.000Z") }]);
  db.seed("modelCall", [{ id: "mc-old", runId: "run-old", agent: "tax", task: "analyse", provider: "claude", model: "x", tier: "SMART", privacy: "anonymize-then-cloud", difficulty: "sop", escalated: false, escalationLevel: 0, anonymized: true, status: "OK", promptHash: "abc", error: `Provider rejected: assessee ${NAME} PAN ${PAN}` }]);
  // The Turia pull's copy of Turia's task list (ADR-003 Amendment 1): the client under two Turia
  // spellings (a pull match and an admin's manual link), and one task found by the kept client code.
  db.seed("turiaClientLink", [
    { key: "old ledger accounts", turiaName: NAME, turiaCode: "OLDLED", lmsClientId: "c-old", firmClientId: "fc-old", status: "matched", lastSeenAt: T0 },
    { key: "old ledger accounts pune", turiaName: `${NAME} (Pune)`, turiaCode: null, lmsClientId: "c-old", firmClientId: "fc-old", status: "manual", updatedById: USERS.admin.id, lastSeenAt: T0 },
  ]);
  const task = (id: string, clientName: string, clientKey: string, taskName: string, clientCode: string | null) => ({
    id, identity: `TSK0${id}`, taskName, clientName, clientKey, clientCode, department: "Income Tax", status: "3", statusName: "Completed", dueOn: null, completedOn: new Date("2016-07-31T00:00:00.000Z"),
    turiaCreatedOn: null, assignees: [{ id: "t-priya", name: "Priya S" }], reviewers: [], hash: `h${id}`, appliedHash: `h${id}`, lastSeenAt: T0, lastChangedAt: T0, missingSince: null, closeCheckedAt: null, jobTaskId: null,
  });
  db.seed("turiaTaskMirror", [
    { ...task("9001", NAME, "old ledger accounts", `ITR FY 2015-16 ${NAME}`, "OLDLED"), jobTaskId: "j-old" },
    task("9002", `${NAME} (Pune)`, "old ledger accounts pune", `TDS return for ${CONTACT}, PAN ${PAN}`, null),
    task("9003", "OLDLED Books", "oldled books", "Books FY 2015-16", "OLDLED"),
  ]);
  db.seed("turiaPullRun", [
    {
      id: "tpr-old",
      mode: "dry-run",
      trigger: "cron",
      status: "ok",
      complete: true,
      counts: { fetched: 4 },
      preview: [
        { action: "wait", task: `TSK09002 · TDS return for ${CONTACT}, PAN ${PAN}`, client: `${NAME} (Pune)`, detail: "Waiting: the Turia client is not matched to a client in the client list." },
        { action: "create", task: "TSK00777 · GSTR-3B Oct 2026", client: "Kumar Traders", detail: "Would create GST · GSTR-3B for Priya Staff." },
      ],
      startedAt: T0,
    },
  ]);
  db.seed("auditEvent", [{ id: "ae-turia-link", actorId: USERS.admin.id, action: "turia-pull.client-link", entity: "TuriaClientLink", entityId: "old ledger accounts pune", meta: { action: "link", from: { status: "unmatched", lmsClientId: null }, to: { status: "manual", lmsClientId: "c-old" } } }]);
}

/**
 * Every Firm OS column that can carry a person's identifiers (docs/dpdp/data-inventory.md), by
 * table. seedShadowCopies() and the staff case put the person's identifiers in each of them, so a
 * column erasure misses shows up as a survivor.
 */
const PERSONAL_COLUMNS: Record<string, readonly string[]> = {
  client: ["name", "folderName", "pan", "contactName", "contactPhone", "contactEmail", "city"],
  auditEvent: ["meta", "entityId"],
  agentRun: ["figures", "reviewNotes"],
  checklistResult: ["message", "evidence"],
  deliverable: ["name", "spPath"],
  jobTask: ["ackRef"],
  jobTaskEvent: ["note"],
  turiaSync: ["evidence"],
  mistakeLog: ["example"],
  coachEvent: ["payload"],
  commsDraft: ["subject", "body"],
  onboardingRun: ["prompt", "spec"],
  certificateIssue: ["clientName", "payload"],
  modelCall: ["error"],
  turiaTaskMirror: ["clientName", "clientKey", "taskName", "assignees", "reviewers"],
  turiaClientLink: ["key", "turiaName"],
  turiaPersonLink: ["turiaName", "turiaEmail"],
  turiaPullRun: ["preview"],
  user: ["name", "email"],
};

/** Every table / column / row where one of the needles survives. */
function survivors(db: MemoryDb, needles: Record<string, string> = NEEDLES): string[] {
  const out: string[] = [];
  for (const [model, rows] of Object.entries(db.tables)) {
    for (const row of rows) {
      for (const [col, val] of Object.entries(row)) {
        const text = typeof val === "string" ? val : val && typeof val === "object" ? JSON.stringify(val) : "";
        for (const [k, needle] of Object.entries(needles)) if (text.toLowerCase().includes(needle.toLowerCase())) out.push(`${model}.${col} [${String(row.id)}] ← ${k}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

async function verifiedErasure(db: MemoryDb, identifiers: Record<string, string>, notes?: string) {
  const r = await createRequest(USERS.admin, { kind: "erasure", identifiers, ...(notes ? { notes } : {}) }, deps(db));
  if (!r.ok) throw new Error(r.error);
  const v = await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person", note: `${CONTACT} showed Aadhaar; PAN ${PAN}` }, deps(db));
  if (!v.ok) throw new Error(v.error);
  return r.data.id;
}

const byDataset = (plan: ErasurePlan) => Object.fromEntries(plan.items.map((i) => [i.dataset, i]));

/** The personal-data columns (PERSONAL_COLUMNS) that hold one of the needles. */
function seeded(db: MemoryDb, needles: Record<string, string>): string[] {
  const all = survivors(db, needles).map((s) => s.split(" ")[0]);
  return Object.entries(PERSONAL_COLUMNS)
    .flatMap(([model, cols]) => cols.map((c) => `${model}.${c}`))
    .filter((mc) => all.includes(mc));
}

describe("erasure completeness (audit finding #5)", () => {
  it("leaves no name, PAN, phone or email of the erased person anywhere, with UPDATEs only", async () => {
    const db = privacyWorld();
    seedShadowCopies(db);
    const id = await verifiedErasure(db, { pan: PAN, email: EMAIL, phone: PHONE }, `${CONTACT} called from ${PHONE} about ${PAN}`);
    // Every Turia pull column the inventory lists for a client is seeded with the person's data.
    expect(seeded(db, NEEDLES)).toEqual(expect.arrayContaining(["turiaTaskMirror.clientName", "turiaTaskMirror.clientKey", "turiaTaskMirror.taskName", "turiaClientLink.key", "turiaClientLink.turiaName", "turiaPullRun.preview", "auditEvent.entityId"]));
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const sizes = Object.fromEntries(Object.entries(db.tables).map(([k, v]) => [k, v.length]));

    const c = await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db));
    // Deliverable files stay in SharePoint (a hold), so the request ends ON_HOLD even with every duty expired.
    expect(c).toMatchObject({ ok: true, data: { status: "ON_HOLD", legalHold: "SharePoint files kept under the firm's retention" } });

    expect(survivors(db)).toEqual([]);
    // The filing reference cleared from the job is cleaned out of the notes too.
    expect(survivors(db, { ack: "ITR-ACK-123456789" })).toEqual([]);

    // Nothing removed; ids, figures and structure kept.
    expect(removalCalls(db.calls)).toEqual([]);
    for (const [model, n] of Object.entries(sizes)) if (model !== "auditEvent") expect(db.tables[model].length, model).toBe(n);
    expect(find(db, "agentRun", "run-old").figures).toEqual({ assessee: "[erased]", pan: "[erased]", totalIncome: 1200000 });
    expect(find(db, "auditEvent", "ae-approve").meta).toEqual({ from: "IN_REVIEW", to: "APPROVED", note: "Checked with [erased] on [erased]" });
    expect(find(db, "auditEvent", "ae-comment")).toMatchObject({ action: "comment", entity: "AgentRun", entityId: "run-old", meta: { text: "[erased] says the PAN [erased] on the ITR is wrong" } });
    expect(find(db, "checklistResult", "cr-old")).toMatchObject({ ruleId: "tax.pan", status: "fail", evidence: { quote: "[erased] [erased]", location: "26AS p1" } });
    expect(find(db, "deliverable", "dl-old")).toMatchObject({ name: "OLDLED_ITR_[erased]_v1.pdf", driveItemId: "item-9", sha256: "x", kind: "Final" });
    expect(find(db, "turiaSync", "ts-old")).toMatchObject({ turiaRef: "T-OLD", minutesLogged: 30, evidence: { key: "k-old" } });
    expect(find(db, "coachEvent", "ce-old").payload).toEqual({ label: "ITR Annual for OLDLED", clientName: "[erased]" });
    expect(find(db, "onboardingRun", "ob-old-failed")).toMatchObject({ prompt: "[erased]", spec: { erased: true }, status: "FAILED", error: "site creation failed" });
    expect(find(db, "commsDraft", "d-old-nojob")).toMatchObject({ subject: "[erased]", body: "[erased]" });
    expect(find(db, "privacyRequest", id)).toMatchObject({ status: "ON_HOLD", principalLabel: expect.stringContaining("OLDLED") });
    // The Turia pull's copy: anonymised under an erased key the next run skips; the match set to ignore.
    const erasedKey = erasedClientKey("old ledger accounts", KEY);
    expect(find(db, "turiaTaskMirror", "9001")).toMatchObject({ clientName: "[erased]", taskName: "[erased]", clientCode: null, clientKey: erasedKey, jobTaskId: "j-old", status: "3" });
    expect(find(db, "turiaTaskMirror", "9003")).toMatchObject({ clientName: "[erased]", clientKey: erasedClientKey("oldled books", KEY) });
    expect(db.tables.turiaClientLink.find((l) => l.key === erasedKey)).toMatchObject({ status: "ignored", turiaName: ERASED_CLIENT_NOTE, lmsClientId: "c-old" });
    expect(find(db, "turiaPullRun", "tpr-old").preview).toEqual([
      { action: "wait", task: "TSK09002 · TDS return for [erased], PAN [erased]", client: "[erased]", detail: "Waiting: the Turia client is not matched to a client in the client list." },
      { action: "create", task: "TSK00777 · GSTR-3B Oct 2026", client: "Kumar Traders", detail: "Would create GST · GSTR-3B for Priya Staff." },
    ]);

    // Every row changed is audited, by row, with masked values only.
    const anonymised = new Set(db.tables.auditEvent.filter((e) => e.action === "anonymise").map((e) => `${String(e.entity)}:${String(e.entityId)}`));
    for (const k of [
      "AuditEvent:ae-comment", "AuditEvent:ae-approve", "AgentRun:run-old", "ChecklistResult:cr-old", "JobTaskEvent:jte-old", "TuriaSync:ts-old", "MistakeLog:ml-old", "CoachEvent:ce-old", "ModelCall:mc-old",
      "OnboardingRun:ob-old-failed", "Deliverable:dl-old", "CommsDraft:d-old-nojob",
      "TuriaTaskMirror:9001", "TuriaTaskMirror:9002", "TuriaTaskMirror:9003", `TuriaClientLink:${erasedKey}`, `TuriaClientLink:${erasedClientKey("old ledger accounts pune", KEY)}`, "TuriaPullRun:tpr-old", "AuditEvent:ae-turia-link",
    ]) {
      expect(anonymised.has(k), k).toBe(true);
    }
    // Re-audit NEW-1: the request's own notes never held the caller's name (masked when typed), so there is nothing left to erase there.
    expect(String(find(db, "privacyRequest", id).notes)).not.toContain(CONTACT);
  });

  it("plans the residue per dataset, with the onboarding run that never reached a client record", async () => {
    const db = privacyWorld();
    seedShadowCopies(db);
    const id = await verifiedErasure(db, { pan: PAN });
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const ds = byDataset(plan);
    expect(ds["onboarding-orphans"]).toMatchObject({ action: "anonymise", records: [{ id: "ob-old-failed" }] });
    for (const key of ["audit-trail-notes", "agent-run-notes", "checklist-findings", "job-history-notes", "deliverable-names", "turia-bridge-evidence", "mistake-examples", "coach-nudges", "model-call-errors", "privacy-register-audit", "turia-client-link-audit", "turia-pull-reports"]) {
      expect(ds[key]?.action, key).toBe("anonymise");
    }
    expect(ds["agent-run-notes"].fields.sort()).toEqual(["figures", "reviewNotes"]);
    expect(ds["agent-run-notes"].consequence).toMatch(/replaced with "\[erased\]"; everything else in them stays/);
  });

  it("leaves no name or email of an erased former staff member in the Turia pull's tables, other people's entries untouched", async () => {
    const db = privacyWorld();
    const STAFF_NEEDLES = { name: "Esha Ex", turiaName: "Esha Exley", email: "esha@indefine.test", turiaEmail: "esha.t@turia.test" };
    db.seed("user", [{ id: "u-ex", name: "Esha Ex", email: "esha@indefine.test", active: false, deactivatedAt: new Date("2015-01-31T00:00:00.000Z"), excludedFromScoring: false, managerId: null }]);
    db.seed("turiaPersonLink", [
      { turiaUserId: "t-esha", turiaName: "Esha Exley", turiaEmail: "esha.t@turia.test", userId: "u-ex", matchedBy: "email", lastSeenAt: T0 },
      { turiaUserId: "t-priya", turiaName: "Priya S", turiaEmail: null, userId: USERS.staff.id, matchedBy: "name", lastSeenAt: T0 },
    ]);
    db.seed("turiaTaskMirror", [
      { id: "9101", identity: "TSK09101", taskName: "AOC-4 FY 2015-16", clientName: "Zenith Components Pvt Ltd", clientKey: "zenith components private limited", clientCode: null, assignees: [{ id: "t-esha", name: "Esha Exley" }], reviewers: [{ id: "t-priya", name: "Priya S" }], hash: "h", lastSeenAt: T0, lastChangedAt: T0 },
      { id: "9102", identity: "TSK09102", taskName: "MGT-7 FY 2015-16", clientName: "Zenith Components Pvt Ltd", clientKey: "zenith components private limited", clientCode: null, assignees: [{ id: "t-priya", name: "Priya S" }], reviewers: [{ id: "t-esha", name: "Esha Exley" }], hash: "h", lastSeenAt: T0, lastChangedAt: T0 },
    ]);
    db.seed("turiaPullRun", [{ id: "tpr-staff", mode: "on", trigger: "cron", status: "ok", complete: true, counts: {}, preview: [{ action: "create", task: "TSK09101 · AOC-4", client: "Zenith Components Pvt Ltd", detail: "Created ROC · AOC-4 for Esha Ex, reviewer Priya Staff." }], startedAt: T0 }]);
    expect(seeded(db, STAFF_NEEDLES)).toEqual(["turiaTaskMirror.assignees", "turiaTaskMirror.reviewers", "turiaPersonLink.turiaName", "turiaPersonLink.turiaEmail", "turiaPullRun.preview", "user.name", "user.email"]);

    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { email: "esha@indefine.test" } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Signed letter matching the records" }, deps(db));
    const plan = (await planErasure(pdb(db), r.data.id, T0, { hashKey: KEY }))!;
    const sizes = Object.fromEntries(Object.entries(db.tables).map(([k, v]) => [k, v.length]));
    expect(await confirmErasure(USERS.admin, r.data.id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true, data: { status: "COMPLETED" } });

    expect(survivors(db, STAFF_NEEDLES)).toEqual([]);
    expect(removalCalls(db.calls)).toEqual([]);
    for (const [model, n] of Object.entries(sizes)) if (model !== "auditEvent") expect(db.tables[model].length, model).toBe(n);
    expect(find(db, "turiaTaskMirror", "9101")).toMatchObject({ assignees: [{ id: "t-esha", name: "[erased]" }], reviewers: [{ id: "t-priya", name: "Priya S" }], clientName: "Zenith Components Pvt Ltd" });
    expect(db.tables.turiaPersonLink.find((p) => p.turiaUserId === "t-priya")).toMatchObject({ turiaName: "Priya S", userId: USERS.staff.id });
    expect((find(db, "turiaPullRun", "tpr-staff").preview as Row[])[0].detail).toBe("Created ROC · AOC-4 for [erased], reviewer Priya Staff.");
  });

  it("holds the review trail of an active client under its duties, and still cleans derived copies", async () => {
    const db = privacyWorld();
    db.seed("auditEvent", [{ id: "ae-kiran", actorId: USERS.reviewer.id, action: "comment", entity: "AgentRun", entityId: "run-prop", meta: { text: "Kiran Kumar wants the GSTR-1 split" } }]);
    db.seed("turiaSync", [{ id: "ts-prop", jobTaskId: "j-prep", firmClientId: "fc-prop", operation: "createTask", mode: "MANUAL", status: "CONFIRMED", evidence: { key: "k1", checklist: [`PAN: ${PAN_PROP}`] } }]);
    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
    const plan = (await planErasure(pdb(db), r.data.id, T0, { hashKey: KEY }))!;
    const ds = byDataset(plan);
    expect(ds["audit-trail-notes"]).toMatchObject({ action: "hold", records: [{ id: "ae-kiran" }] });
    expect(ds["audit-trail-notes"].basis.map((b) => b.id)).toEqual(["active-engagement", "gst", "icai"]);
    expect(ds["turia-bridge-evidence"]).toMatchObject({ action: "anonymise", records: [{ id: "ts-prop" }] });

    const c = await confirmErasure(USERS.admin, r.data.id, { fingerprint: plan.fingerprint }, deps(db));
    expect(c.ok).toBe(true);
    expect(find(db, "auditEvent", "ae-kiran").meta).toEqual({ text: "Kiran Kumar wants the GSTR-1 split" });
    expect(find(db, "turiaSync", "ts-prop").evidence).toEqual({ key: "k1", checklist: ["PAN: [erased]"] });
    const hold = db.tables.auditEvent.find((e) => e.action === "legal-hold" && e.entity === "AuditEvent" && e.entityId === "ae-kiran");
    expect(hold?.meta).toMatchObject({ basis: ["active-engagement", "gst", "icai"], dataset: "audit-trail-notes", privacyRequestId: r.data.id });
  });

  it("for a company's contact person, cleans only their own details out of the company's records", async () => {
    const db = privacyWorld();
    db.seed("coachEvent", [{ id: "ce-co", userId: USERS.staff.id, kind: "reminder", jobTaskId: "j-done", payload: { message: "Call Zara Iyer (9123456780) at Zenith Components Pvt Ltd" } }]);
    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { email: "zara@zenith.test" } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Reply from the email address on record" }, deps(db));
    const plan = (await planErasure(pdb(db), r.data.id, T0, { hashKey: KEY }))!;
    expect(await confirmErasure(USERS.admin, r.data.id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true });
    expect(find(db, "coachEvent", "ce-co").payload).toEqual({ message: "Call [erased] ([erased]) at Zenith Components Pvt Ltd" });
  });

  it("finds an onboarding run for a person no client record matches, by the request's identifier hash", async () => {
    // Ported from .audit-sec/dpdp/privacy-state-machine.test.ts: "0 items anonymised" while the PAN lived on.
    const db = privacyWorld();
    const GHOST_PAN = "GHOPG9999G";
    db.seed("onboardingRun", [
      { id: "ob-ghost", createdById: USERS.partner.id, prompt: `Onboard Ghost Traders PAN ${GHOST_PAN}`, spec: { pan: GHOST_PAN }, plan: null, status: "DRAFT", steps: null, error: null, firmClientId: null },
      { id: "ob-other", createdById: USERS.partner.id, prompt: "Onboard Someone Else PAN OTHER1234Z", spec: { pan: "OTHER1234Z" }, plan: null, status: "DRAFT", steps: null, error: null, firmClientId: null },
    ]);
    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { pan: GHOST_PAN } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.matches).toBe(0);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
    const plan = (await planErasure(pdb(db), r.data.id, T0, { hashKey: KEY }))!;
    expect(plan.items.map((i) => [i.dataset, i.action, i.records?.map((x) => x.id)])).toEqual([["onboarding-orphans", "anonymise", ["ob-ghost"]]]);
    // Hashed with another key, the identifiers do not match: nothing is found.
    expect((await planErasure(pdb(db), r.data.id, T0, { hashKey: "other" }))!.items).toEqual([]);

    const c = await confirmErasure(USERS.admin, r.data.id, { fingerprint: plan.fingerprint }, deps(db));
    expect(c).toMatchObject({ ok: true, data: { status: "COMPLETED" } });
    expect(JSON.stringify(db.tables.onboardingRun)).not.toContain(GHOST_PAN);
    expect(find(db, "onboardingRun", "ob-other")).toMatchObject({ prompt: "Onboard Someone Else PAN OTHER1234Z" });
    expect(find(db, "privacyRequest", r.data.id).outcome).toMatch(/^1 item anonymised/);
  });
});

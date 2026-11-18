// The Turia pull's tables under the DPDP rights (ADR-003 Amendment 1, docs/dpdp/data-inventory.md):
// what a client or a staff member gets in their access export, what erasure does to the mirror, the
// client and person matches and the run reports, and that the next pull run — fed the database the
// erasure left — neither copies the person back from Turia nor maps them again.
import { describe, expect, it } from "vitest";
import { createPullWorld, rawTask } from "../../../tests/fakes/turia-pull-world";
import { ERASED_CLIENT_NOTE, erasedClientKey } from "@/lib/integrations/turia/pull/erased";
import { runTuriaPull } from "@/lib/integrations/turia/pull/sync";
import { confirmErasure, planErasure, publicPlan, type ErasurePlan } from "./erasure";
import { buildAccessExport, WITHHELD_THIRD_PARTY } from "./export";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import { T0, USERS, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

type Row = Record<string, unknown>;
const KEY = "k";
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: KEY });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const rowOf = (db: MemoryDb, model: string, id: string, by = "id") => db.tables[model].find((r) => r[by] === id) as Row;

const OLD = "Old Ledger Accounts";
const OLD_PUNE = "Old Ledger Accounts (Pune)";

function mirror(id: string, clientName: string, clientKey: string, taskName: string, over: Row = {}): Row {
  return {
    id,
    identity: `TSK00${id}`,
    taskName,
    clientName,
    clientKey,
    clientCode: null,
    department: "Compliance",
    status: "1",
    statusName: "Open",
    dueOn: new Date("2026-11-20T00:00:00.000Z"),
    completedOn: null,
    turiaCreatedOn: null,
    assignees: [{ id: "t-priya", name: "Priya Subramanian" }],
    reviewers: [{ id: "t-ravi", name: "Ravi K" }],
    hash: `h-${id}`,
    appliedHash: null,
    lastSeenAt: T0,
    lastChangedAt: T0,
    missingSince: null,
    closeCheckedAt: null,
    jobTaskId: null,
    ...over,
  };
}

/** What the Turia pull would have stored for the privacy world's clients and staff. */
function seedTuria(db: MemoryDb) {
  db.seed("turiaClientLink", [
    { key: "old ledger accounts", turiaName: OLD, turiaCode: null, lmsClientId: "c-old", firmClientId: "fc-old", status: "matched", lastSeenAt: T0 },
    { key: "old ledger accounts pune", turiaName: OLD_PUNE, turiaCode: null, lmsClientId: "c-old", firmClientId: "fc-old", status: "manual", lastSeenAt: T0 },
    { key: "kumar traders", turiaName: "Kumar Traders", turiaCode: "KUMAR1", lmsClientId: "c-prop", firmClientId: "fc-prop", status: "matched", lastSeenAt: T0 },
    { key: "zenith components private limited", turiaName: "Zenith Components Pvt Ltd", turiaCode: null, lmsClientId: "c-co", firmClientId: "fc-co", status: "matched", lastSeenAt: T0 },
    // An admin set this Turia client to ignore: it is not taken for Lalitha Consulting by its name.
    { key: "lalitha consulting", turiaName: "Lalitha Consulting", turiaCode: null, lmsClientId: null, firmClientId: null, status: "ignored", lastSeenAt: T0 },
  ]);
  db.seed("turiaTaskMirror", [
    mirror("901", OLD, "old ledger accounts", `ITR FY 2015-16 ${OLD}`),
    mirror("902", OLD_PUNE, "old ledger accounts pune", "TDS return Q4"),
    // No link yet; Turia's client code equals the FirmClient code (the pull matches on it first).
    mirror("903", "OLDLED Books", "oldled books", "Books FY 2015-16", { clientCode: "OLDLED" }),
    mirror("911", "Kumar Traders", "kumar traders", "GSTR-3B Oct 2026", { jobTaskId: "j-assigned" }),
    mirror("921", "Zenith Components Pvt Ltd", "zenith components private limited", "AOC-4 FY 2025-26", { assignees: [{ id: "t-ravi", name: "Ravi K" }], reviewers: [{ id: "t-priya", name: "Priya Subramanian" }] }),
    mirror("931", "Lalitha Consulting", "lalitha consulting", "Quote"),
    mirror("941", "Other People Pvt Ltd", "other people private limited", "Audit", { assignees: [{ id: "t-ravi", name: "Ravi K" }], reviewers: [] }),
  ]);
  db.seed("turiaPersonLink", [
    { turiaUserId: "t-priya", turiaName: "Priya Subramanian", turiaEmail: "priya.s@turia.test", userId: USERS.staff.id, matchedBy: "email", lastSeenAt: T0 },
    { turiaUserId: "t-ravi", turiaName: "Ravi K", turiaEmail: null, userId: USERS.reviewer.id, matchedBy: "name", lastSeenAt: T0 },
  ]);
  db.seed("turiaPullRun", [
    {
      id: "run-1",
      mode: "dry-run",
      trigger: "cron",
      status: "ok",
      complete: true,
      counts: { fetched: 7 },
      preview: [
        { action: "wait", task: `TSK00901 · ITR FY 2015-16 ${OLD}`, client: OLD, detail: "Skipped: this Turia client is set to ignore." },
        { action: "create", task: "TSK00911 · GSTR-3B Oct 2026", client: "Kumar Traders", detail: "Would create GST · GSTR-3B · 2026-10 FY 2026-27 for Priya Staff, reviewer Ravi Reviewer." },
        { action: "create", task: "TSK00941 · Audit", client: "Other People Pvt Ltd", detail: "Would create Audit for Ravi Reviewer." },
      ],
      startedAt: T0,
    },
  ]);
}

async function request(db: MemoryDb, kind: "access" | "erasure", identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  const v = await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
  if (!v.ok) throw new Error(v.error);
  return r.data.id;
}

const records = async (db: MemoryDb, id: string, key: string) => (await buildAccessExport(pdb(db), id, T0, KEY))!.datasets.find((d) => d.key === key)!.records;
const byDataset = (plan: ErasurePlan) => {
  const out: Record<string, ErasurePlan["items"]> = {};
  for (const i of plan.items) (out[i.dataset] ??= []).push(i);
  return out;
};

/** A pull world holding exactly the Turia tables (and the clients, users and restrictions) the erasure left. */
function pullWorldFrom(db: MemoryDb) {
  const w = createPullWorld(new Date("2026-11-06T05:30:00Z"));
  w.seedFirm();
  w.env.AUTH_SECRET = KEY;
  for (const model of ["turiaTaskMirror", "turiaClientLink", "turiaPersonLink"] as const) w.db[model].rows.push(...structuredClone(db.tables[model] ?? []));
  w.db.client.rows.push(...structuredClone(db.tables.client).map((c) => ({ id: c.id, name: c.name })));
  w.db.firmClient.rows.push(...structuredClone(db.tables.firmClient).map((f) => ({ id: f.id, lmsClientId: f.lmsClientId, clientCode: f.clientCode })));
  w.db.auditEvent.rows.push(...structuredClone(db.tables.auditEvent.filter((e) => e.action === "restrict-processing" || e.action === "lift-restriction")));
  return w;
}

describe("access export: the Turia pull's copy", () => {
  it("gives a client their Turia tasks and matches, found by link, by code and by name, without staff names", async () => {
    const db = privacyWorld();
    seedTuria(db);
    const id = await request(db, "access", { pan: "DEFPO1111A" });
    const tasks = await records(db, id, "turia-tasks");
    expect(tasks.map((r) => r.id)).toEqual(["901", "902", "903"]);
    expect(tasks[0].values).toEqual({
      identity: "TSK00901",
      taskName: `ITR FY 2015-16 ${OLD}`,
      clientName: OLD,
      clientCode: null,
      department: "Compliance",
      statusName: "Open",
      dueOn: new Date("2026-11-20T00:00:00.000Z"),
      completedOn: null,
    });
    const links = await records(db, id, "turia-client-links");
    expect(links.map((r) => r.values)).toEqual([
      { turiaName: OLD, turiaCode: null, status: "matched" },
      { turiaName: OLD_PUNE, turiaCode: null, status: "manual" },
    ]);
    const text = JSON.stringify(await buildAccessExport(pdb(db), id, T0, KEY));
    for (const other of ["Priya", "Ravi", "Kumar Traders", "Zenith", "Other People", "t-priya"]) expect(text).not.toContain(other);
  });

  it("never takes a Turia client another client shares the name with, one an admin ignored, or one linked to someone else", async () => {
    const db = privacyWorld();
    seedTuria(db);
    db.seed("client", [
      { id: "c-same-1", name: "Same Name Traders", folderName: "Same Name Traders", entityType: "INDIVIDUAL", pan: "SAMPS1111S", contactEmail: null, contactPhone: null, contactName: null, active: false, createdById: USERS.partner.id },
      { id: "c-same-2", name: "Same Name Traders.", folderName: "Same Name Traders 2", entityType: "INDIVIDUAL", pan: "SAMPS2222S", contactEmail: null, contactPhone: null, contactName: null, active: false, createdById: USERS.partner.id },
      // The only client with this name, but its Turia match points at another client.
      { id: "c-other", name: "Other People Private Limited", folderName: "Other People", entityType: "INDIVIDUAL", pan: "OTHPS3333K", contactEmail: null, contactPhone: null, contactName: null, active: false, createdById: USERS.partner.id },
    ]);
    db.seed("turiaTaskMirror", [mirror("951", "Same Name Traders", "same name traders", "ITR")]);
    db.seed("turiaClientLink", [{ key: "other people private limited", turiaName: "Other People Pvt Ltd", turiaCode: null, lmsClientId: "c-co", firmClientId: "fc-co", status: "manual", lastSeenAt: T0 }]);
    for (const [pan, task] of [["SAMPS1111S", "951"], ["BCDPL4321M", "931"], ["OTHPS3333K", "941"]]) {
      const id = await request(db, "access", { pan });
      expect((await records(db, id, "turia-tasks")).map((r) => r.id), task).toEqual([]);
    }
    // Kumar Traders itself gets its own.
    const own = await request(db, "access", { pan: "ABCPK1234F" });
    expect((await records(db, own, "turia-tasks")).map((r) => r.id)).toEqual(["911"]);
  });

  it("gives a staff member their Turia match and tasks, with other people's names and the client's withheld", async () => {
    const db = privacyWorld();
    seedTuria(db);
    const id = await request(db, "access", { email: "priya@indefine.test" });
    expect((await records(db, id, "staff-turia-link")).map((r) => [r.id, r.values])).toEqual([["t-priya", { turiaName: "Priya Subramanian", turiaEmail: "priya.s@turia.test", matchedBy: "email" }]]);
    const tasks = await records(db, id, "staff-turia-tasks");
    expect(tasks.map((r) => r.id)).toEqual(["901", "902", "903", "911", "921", "931"]);
    expect(tasks[0].values).toMatchObject({ taskName: `ITR FY 2015-16 ${WITHHELD_THIRD_PARTY}`, role: ["assignee"], assignees: ["Priya Subramanian"], reviewers: [WITHHELD_THIRD_PARTY] });
    expect(tasks.find((r) => r.id === "921")!.values).toMatchObject({ role: ["reviewer"], assignees: [WITHHELD_THIRD_PARTY], reviewers: ["Priya Subramanian"] });
    const text = JSON.stringify(tasks);
    for (const other of ["Ravi", "t-ravi", OLD, "Other People"]) expect(text).not.toContain(other);
  });
});

describe("erasure: the Turia pull's copy", () => {
  it("anonymises an old client's Turia copies and sets its match to ignore; the next pull run copies nothing back, re-creates no match and makes no job", async () => {
    const db = privacyWorld();
    seedTuria(db);
    db.seed("auditEvent", [{ id: "ae-link", actorId: USERS.admin.id, action: "turia-pull.client-link", entity: "TuriaClientLink", entityId: "old ledger accounts pune", meta: { action: "link", to: { status: "manual", lmsClientId: "c-old" } } }]);
    const id = await request(db, "erasure", { pan: "DEFPO1111A" });
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const ds = byDataset(plan);
    const erased = erasedClientKey("old ledger accounts", KEY);
    const erasedPune = erasedClientKey("old ledger accounts pune", KEY);
    expect(ds["turia-tasks"].map((i) => [i.recordId, i.action])).toEqual([["901", "anonymise"], ["902", "anonymise"], ["903", "anonymise"]]);
    expect(ds["turia-client-links"].map((i) => [i.recordId, i.action])).toEqual([[erased, "anonymise"], [erasedPune, "anonymise"]]);
    expect(ds["turia-client-links"][0].consequence).toMatch(/set to ignore under an erased key/);
    expect(ds["turia-pull-reports"][0]).toMatchObject({ action: "anonymise", records: [{ id: "run-1" }] });
    expect(ds["turia-client-link-audit"][0]).toMatchObject({ action: "anonymise", records: [{ id: "ae-link" }] });
    expect(ds.turia[0]).toMatchObject({ action: "manual" }); // Turia itself is a partner's manual step
    expect(publicPlan(plan).items.every((i) => i.where === undefined && i.set === undefined)).toBe(true);
    expect(JSON.stringify(publicPlan(plan))).not.toMatch(/old ledger/i);

    expect(await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true });
    expect(removalCalls(db.calls)).toEqual([]);
    expect(rowOf(db, "turiaTaskMirror", "901")).toMatchObject({ taskName: "[erased]", clientName: "[erased]", clientCode: null, clientKey: erased, hash: "[erased]", assignees: [{ id: "t-priya", name: "Priya Subramanian" }] });
    expect(rowOf(db, "turiaTaskMirror", "903")).toMatchObject({ clientName: "[erased]", clientKey: erasedClientKey("oldled books", KEY) });
    expect(rowOf(db, "turiaClientLink", erased, "key")).toMatchObject({ turiaName: ERASED_CLIENT_NOTE, turiaCode: null, status: "ignored", lmsClientId: "c-old" });
    expect(rowOf(db, "auditEvent", "ae-link")).toMatchObject({ entity: "TuriaClientLink", entityId: erasedPune });
    const preview = rowOf(db, "turiaPullRun", "run-1").preview as Row[];
    expect(preview[0]).toEqual({ action: "wait", task: "TSK00901 · ITR FY 2015-16 [erased]", client: "[erased]", detail: "Skipped: this Turia client is set to ignore." });
    expect(preview.slice(1).map((p) => p.client)).toEqual(["Kumar Traders", "Other People Pvt Ltd"]); // other clients' lines stay
    const anonymised = db.tables.auditEvent.filter((e) => e.action === "anonymise").map((e) => `${String(e.entity)}:${String(e.entityId)}`);
    expect(anonymised).toEqual(expect.arrayContaining(["TuriaTaskMirror:901", `TuriaClientLink:${erased}`, "TuriaPullRun:run-1", `AuditEvent:ae-link`]));
    expect(JSON.stringify(db.tables.auditEvent)).not.toMatch(/old ledger/i);
    const erasedRows = (rows: Row[]) => structuredClone([rows.filter((m) => ["901", "902", "903"].includes(String(m.id))), rows.filter((l) => String(l.key ?? "").startsWith("erased:"))]);
    const afterErasure = erasedRows([...db.tables.turiaTaskMirror, ...db.tables.turiaClientLink]);

    // Turia is not cleaned yet: it still lists the client's tasks, one of them changed and one new.
    const w = pullWorldFrom(db);
    w.turia.pages = [
      [
        rawTask({ id: "901", clientname: OLD, taskname: "ITR FY 2015-16 revised", taskstatus: "2" }),
        rawTask({ id: "902", clientname: OLD_PUNE, taskname: "TDS return Q4" }),
        rawTask({ id: "905", clientname: OLD, taskname: "GSTR-3B Oct 2026" }),
      ],
    ];
    const r = await runTuriaPull(w.deps(), { trigger: "cron", actorId: null });
    expect(r.status).toBe("ok");
    expect(r.counts).toMatchObject({ fetched: 3, erased: 3, new: 0, changed: 0, create: 0, link: 0 });
    expect(erasedRows([...w.db.turiaTaskMirror.rows, ...w.db.turiaClientLink.rows])).toEqual(afterErasure);
    expect(w.db.turiaClientLink.rows.filter((l) => /old ledger/.test(String(l.key)))).toEqual([]);
    expect(w.db.turiaTaskMirror.rows.find((m) => m.id === "905")).toBeUndefined();
    expect(w.db.jobTask.rows).toEqual([]);
    expect(w.db.firmClient.rows.filter((f) => f.lmsClientId === "c-old")).toHaveLength(1);
    expect(JSON.stringify([w.db.turiaTaskMirror.rows, w.db.turiaClientLink.rows, w.db.turiaPullRun.rows])).not.toMatch(/old ledger/i);
  });

  it("holds an active client's Turia copies, restricts its processing, and the next pull mirrors its tasks but makes no job", async () => {
    const db = privacyWorld();
    seedTuria(db);
    const id = await request(db, "erasure", { pan: "ABCPK1234F" });
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const ds = byDataset(plan);
    expect(ds["turia-tasks"].map((i) => [i.recordId, i.action])).toEqual([["911", "hold"]]);
    expect(ds["turia-tasks"][0].basis.map((b) => b.id)).toEqual(["active-engagement", "gst", "icai"]);
    expect(ds["turia-client-links"].map((i) => i.action)).toEqual(["hold"]);
    // The run report is a copy: cleaned at once, like the Turia bridge checklists.
    expect(ds["turia-pull-reports"][0]).toMatchObject({ action: "anonymise", records: [{ id: "run-1" }] });
    expect(await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true, data: { status: "ON_HOLD" } });
    expect(rowOf(db, "turiaClientLink", "kumar traders", "key")).toMatchObject({ status: "matched", lmsClientId: "c-prop", turiaName: "Kumar Traders" });
    expect(rowOf(db, "turiaTaskMirror", "911")).toMatchObject({ clientName: "Kumar Traders", taskName: "GSTR-3B Oct 2026" });
    expect((rowOf(db, "turiaPullRun", "run-1").preview as Row[])[1]).toMatchObject({ client: "[erased]" });
    expect(db.tables.auditEvent.some((e) => e.action === "legal-hold" && e.entity === "TuriaTaskMirror" && e.entityId === "911")).toBe(true);

    const w = pullWorldFrom(db);
    w.turia.pages = [[rawTask({ id: "911", clientname: "Kumar Traders", taskname: "GSTR-3B Oct 2026" }), rawTask({ id: "912", clientname: "Kumar Traders", taskname: "GSTR-1 Oct 2026" })]];
    const r = await runTuriaPull(w.deps(), { trigger: "cron", actorId: null });
    expect(r.counts).toMatchObject({ restricted: 2, create: 0, link: 0, erased: 0 });
    expect(w.db.turiaTaskMirror.rows.find((m) => m.id === "912")).toMatchObject({ clientName: "Kumar Traders" }); // still mirrored
    expect(w.db.jobTask.rows).toEqual([]);
    expect(r.preview.find((p) => p.task.startsWith("TSK00912"))).toMatchObject({ action: "wait", detail: expect.stringMatching(/restricted processing/) });
  });

  it("erases a former staff member's Turia match, their entries in Turia task lists and their name in run reports; the next pull neither matches nor renames them", async () => {
    const db = privacyWorld();
    seedTuria(db);
    db.seed("user", [{ id: "u-ex", name: "Esha Ex", email: "esha@indefine.test", active: false, deactivatedAt: new Date("2015-01-31T00:00:00.000Z"), excludedFromScoring: false, managerId: null }]);
    db.seed("turiaPersonLink", [{ turiaUserId: "t-esha", turiaName: "Esha Exley", turiaEmail: "esha.t@turia.test", userId: "u-ex", matchedBy: "email", lastSeenAt: T0 }]);
    db.seed("turiaTaskMirror", [mirror("961", "Zenith Components Pvt Ltd", "zenith components private limited", "MGT-7", { assignees: [{ id: "t-esha", name: "Esha Exley" }, { id: "t-priya", name: "Priya Subramanian" }], reviewers: [{ id: "t-esha", name: "Esha Exley" }] })]);
    db.seed("turiaPullRun", [{ id: "run-2", mode: "on", trigger: "cron", status: "ok", complete: true, counts: {}, preview: [{ action: "create", task: "TSK00961 · MGT-7", client: "Zenith Components Pvt Ltd", detail: "Created ROC · MGT-7 for Esha Ex, reviewer Ravi Reviewer." }], startedAt: T0 }]);
    const id = await request(db, "erasure", { email: "esha@indefine.test" });
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const ds = byDataset(plan);
    expect(ds["staff-turia-link"].map((i) => [i.recordId, i.action])).toEqual([["t-esha", "anonymise"]]);
    expect(ds["staff-turia-tasks"].map((i) => [i.recordId, i.action])).toEqual([["961", "anonymise"]]);
    expect(ds["staff-turia-pull-reports"][0]).toMatchObject({ action: "anonymise", records: [{ id: "run-2" }] });
    expect(await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true, data: { status: "COMPLETED" } });
    expect(rowOf(db, "turiaPersonLink", "t-esha", "turiaUserId")).toMatchObject({ turiaName: "[erased]", turiaEmail: null, userId: null, matchedBy: "erased" });
    expect(rowOf(db, "turiaTaskMirror", "961")).toMatchObject({
      assignees: [{ id: "t-esha", name: "[erased]" }, { id: "t-priya", name: "Priya Subramanian" }],
      reviewers: [{ id: "t-esha", name: "[erased]" }],
      clientName: "Zenith Components Pvt Ltd",
    });
    expect((rowOf(db, "turiaPullRun", "run-2").preview as Row[])[0].detail).toBe("Created ROC · MGT-7 for [erased], reviewer Ravi Reviewer.");
    expect(JSON.stringify(db.tables)).not.toMatch(/Esha|esha@|esha\.t@/);

    // Turia still has the person; an active LMS user even has their Turia name and email.
    const w = pullWorldFrom(db);
    w.db.user.rows.push({ id: "u-esha-2", name: "Esha Exley", email: "esha.t@turia.test", active: true });
    w.turia.users.push({ id: "t-esha", name: "Esha Exley", email: "esha.t@turia.test" });
    w.turia.pages = [[rawTask({ id: "961", clientname: "Zenith Components Pvt Ltd", taskname: "MGT-7", assignee: [{ id: "t-esha", name: "Esha Exley" }], reviewer: [{ id: "t-esha", name: "Esha Exley" }] })]];
    await runTuriaPull(w.deps(), { trigger: "cron", actorId: null });
    expect(w.db.turiaPersonLink.rows.find((p) => p.turiaUserId === "t-esha")).toMatchObject({ turiaName: "[erased]", turiaEmail: null, userId: null, matchedBy: "erased" });
    expect(w.db.turiaTaskMirror.rows.find((m) => m.id === "961")).toMatchObject({ assignees: [{ id: "t-esha", name: "[erased]" }], reviewers: [{ id: "t-esha", name: "[erased]" }] });
    expect(w.db.jobTask.rows).toEqual([]);
    expect(JSON.stringify([w.db.turiaTaskMirror.rows, w.db.turiaPersonLink.rows])).not.toMatch(/Esha/);
  });

  it("holds an employed staff member's Turia match and task entries (employment records)", async () => {
    const db = privacyWorld();
    seedTuria(db);
    const id = await request(db, "erasure", { email: "priya@indefine.test" });
    const ds = byDataset((await planErasure(pdb(db), id, T0, { hashKey: KEY }))!);
    expect(ds["staff-turia-link"].map((i) => [i.recordId, i.action, i.holdUntilLabel])).toEqual([["t-priya", "hold", "Until the person leaves the firm"]]);
    expect(new Set(ds["staff-turia-tasks"].map((i) => i.action))).toEqual(new Set(["hold"]));
    // Her name in the run report is a copy: cleaned at once.
    expect(ds["staff-turia-pull-reports"][0]).toMatchObject({ action: "anonymise", records: [{ id: "run-1" }] });
  });

  it("does not clean a staff name another user shares out of the run reports", async () => {
    const db = privacyWorld();
    seedTuria(db);
    db.seed("user", [{ id: "u-ravi-2", name: "Ravi Reviewer", email: "ravi.two@indefine.test", active: true, excludedFromScoring: false, managerId: null }]);
    const id = await request(db, "erasure", { email: "ravi@indefine.test" });
    const ds = byDataset((await planErasure(pdb(db), id, T0, { hashKey: KEY }))!);
    expect(ds["staff-turia-pull-reports"]).toBeUndefined();
    expect(ds["staff-turia-link"].map((i) => i.recordId)).toEqual(["t-ravi"]);
  });
});

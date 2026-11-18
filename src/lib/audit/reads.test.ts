// Security audit #6: reads of client data were not audited, so the breach runbook could not answer
// "who accessed client X". Ported from the audit PoCs (.audit-sec/dpdp/repo-scan.test.ts "reads of
// client PII are not audited", .audit-sec/dpdp/deliverable-access.test.ts "download audited, preview
// not"): the loaders now write a masked "view" AuditEvent (one per person per record per hour) and
// file exports an "export" every time.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_DEDUPE_MS, auditRead, maskReadMeta } from "./reads";
import type { AuditDb, AuditEventRow } from "./log";

const appRows = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create: async (a: { data: unknown }) => { appRows.push(a.data); return { id: `a${appRows.length}` }; } } } }));

function recorder() {
  const rows: AuditEventRow[] = [];
  const db: AuditDb = { auditEvent: { create: async ({ data }) => { rows.push(data); return { id: `e${rows.length}` }; } } };
  return { db, rows };
}

const T0 = new Date("2026-11-06T05:00:00.000Z");

beforeEach(() => {
  appRows.length = 0;
});

describe("auditRead", () => {
  it("one view per person per record per hour; exports every time; other people and records separate", async () => {
    const { db, rows } = recorder();
    const v = (actorId: string, entityId: string, at: Date) => auditRead(db, { actorId, entity: "AgentRun", entityId, now: at });
    expect(await v("u-1", "run-1", T0)).toBe(true);
    expect(await v("u-1", "run-1", new Date(T0.getTime() + 59 * 60_000))).toBe(false);
    expect(await v("u-2", "run-1", T0)).toBe(true);
    expect(await v("u-1", "run-2", T0)).toBe(true);
    expect(await v("u-1", "run-1", new Date(T0.getTime() + VIEW_DEDUPE_MS))).toBe(true);
    expect(await auditRead(db, { actorId: "u-1", entity: "Client", entityId: null, action: "export", now: T0 })).toBe(true);
    expect(await auditRead(db, { actorId: "u-1", entity: "Client", entityId: null, action: "export", now: T0 })).toBe(true);
    expect(rows.map((r) => `${r.action} ${r.entity} ${r.entityId} ${r.actorId}`)).toEqual([
      "view AgentRun run-1 u-1",
      "view AgentRun run-1 u-2",
      "view AgentRun run-2 u-1",
      "view AgentRun run-1 u-1",
      "export Client null u-1",
      "export Client null u-1",
    ]);
  });

  it("meta is masked: ids, codes and counts only; names, PAN, e-mail and free text never stored", () => {
    expect(
      maskReadMeta({ clientCode: "ACME01", jobTaskId: "job-1", rows: 12, clientName: "Acme Pvt Ltd", pan: "ABCDE1234F", email: "a@b.in", note: "call him", label: "Acme Pvt Ltd", filters: ["fy", "Acme Pvt"] }),
    ).toEqual({ clientCode: "ACME01", jobTaskId: "job-1", rows: 12, label: "[masked]", filters: ["fy", "[masked]"] });
    expect(maskReadMeta({ name: "x" })).toBeUndefined();
  });

  it("a failing audit write never breaks the read, and is retried on the next load", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const rows: unknown[] = [];
    const db: AuditDb = { auditEvent: { create: async ({ data }) => { if (fail) throw new Error("pool timeout"); rows.push(data); return { id: "x" }; } } };
    expect(await auditRead(db, { actorId: "u-1", entity: "CommsDraft", entityId: "d-1", now: T0 })).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("could not record view of CommsDraft d-1: pool timeout"));
    fail = false;
    expect(await auditRead(db, { actorId: "u-1", entity: "CommsDraft", entityId: "d-1", now: T0 })).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

describe("helpers for the clients loaders and routes (app Prisma client)", () => {
  it("client detail view, report export and workbook download", async () => {
    const { auditClientView, auditClientReportExport, auditClientWorkbookDownload } = await import("./reads");
    const user = { id: "u-9" };
    expect(await auditClientView(user, "client-1", { clientCode: "ACME01" })).toBe(true);
    expect(await auditClientView(user, "client-1", { clientCode: "ACME01" })).toBe(false); // same hour
    expect(await auditClientReportExport(user, { rows: 40, filters: ["fy", "service"] })).toBe(true);
    expect(await auditClientWorkbookDownload(user, { bytes: 1234 })).toBe(true);
    expect(appRows).toEqual([
      { actorId: "u-9", action: "view", entity: "Client", entityId: "client-1", meta: { clientCode: "ACME01" } },
      { actorId: "u-9", action: "export", entity: "Client", entityId: null, meta: { what: "client-jobs-report", rows: 40, format: "xlsx", filters: ["fy", "service"] } },
      { actorId: "u-9", action: "export", entity: "Client", entityId: null, meta: { what: "client-workbook", bytes: 1234 } },
    ]);
  });
});

describe("the loaders write the view (PoC #6)", () => {
  it("agent run review (loadRunReview): one masked view per person per hour", async () => {
    const { echoWorld, rows, user, NOW } = await import("../../../tests/fakes/agent-world");
    const { startAgentRun } = await import("@/lib/agents/service");
    const { loadRunReview } = await import("@/lib/agents/views");
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const before = rows(w.db, "auditEvent").length;
    await loadRunReview(w.db as never, user("ravi"), "run-1", NOW);
    await loadRunReview(w.db as never, user("ravi"), "run-1", new Date(NOW.getTime() + 10 * 60_000));
    expect(await loadRunReview(w.db as never, user("outsider"), "run-1", NOW)).toBeNull(); // no access: no read, no row
    const views = rows(w.db, "auditEvent").slice(before);
    expect(views).toEqual([expect.objectContaining({ actorId: "u-ravi", action: "view", entity: "AgentRun", entityId: "run-1", meta: { agent: "echo", jobTaskId: "job-1", clientCode: "ACME01" } })]);
  }, 60_000);

  it("deliverable preview is audited as a view; download stays an export", async () => {
    const { echoWorld, rows, user } = await import("../../../tests/fakes/agent-world");
    const { startAgentRun, previewDeliverable, exportDeliverable } = await import("@/lib/agents/service");
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const sheet = rows(w.db, "deliverable").find((d) => String(d.name).endsWith(".xlsx"))!;
    expect((await exportDeliverable(user("meera"), sheet.id as string, w.deps)).ok).toBe(true);
    expect((await previewDeliverable(user("meera"), sheet.id as string, w.deps)).ok).toBe(true);
    expect((await previewDeliverable(user("outsider"), sheet.id as string, w.deps)).ok).toBe(false);
    const audits = rows(w.db, "auditEvent").filter((a) => a.entity === "Deliverable");
    expect(audits.map((a) => `${a.action} by ${a.actorId}`)).toEqual(["export by u-meera", "view by u-meera"]);
  }, 60_000);
});

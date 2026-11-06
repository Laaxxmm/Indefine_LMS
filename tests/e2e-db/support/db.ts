// Database setup and assertions for the DB-backed golden paths (Prisma against the staging DB the
// app uses). Setup is create-only — fresh JobTasks with unique titles, SOP packs only when none is
// active — so `--repeat-each=3` never collides and nothing is ever deleted.
import { expect } from "@playwright/test";
import { PrismaClient, type FirmService, type JobTaskState } from "@prisma/client";
import { getAgent } from "@/lib/agents/registry";
import { seedGstSopPack } from "@/lib/agents/gst/seed";
import { need, runTag, type E2EVar } from "./env";

let shared: PrismaClient | null = null;

/** One client per worker; call db.$disconnect() in afterAll (or use withDb). */
export function openDb(): PrismaClient {
  shared ??= new PrismaClient();
  return shared;
}

export async function closeDb(): Promise<void> {
  if (shared) await shared.$disconnect();
  shared = null;
}

/**
 * The agent's SOP pack, created from its built-in v1.0.0 checklist when no active pack exists.
 * Staging only: production packs are seeded after partner review (docs/go-live.md "Seed SOP packs").
 */
export async function ensureSopPack(db: PrismaClient, agentKey: string): Promise<string> {
  if (agentKey === "gst") return (await seedGstSopPack(db)).version;
  const def = getAgent(agentKey);
  if (!def) throw new Error(`Unknown agent ${agentKey}`);
  const active = await db.sopPack.findFirst({ where: { key: def.sopPackKey, active: true }, select: { version: true } });
  if (active) return active.version;
  const [major, minor, patch] = def.defaultChecklist.version.split(".").map(Number);
  await db.sopPack.create({
    data: { key: def.sopPackKey, version: def.defaultChecklist.version, major, minor, patch, title: def.title, checklist: JSON.parse(JSON.stringify(def.defaultChecklist)), active: true, changeNote: "e2e staging seed" },
  });
  return def.defaultChecklist.version;
}

export async function userByEmail(db: PrismaClient, envName: E2EVar, spec?: string) {
  const email = need(envName, spec);
  return db.user.findFirstOrThrow({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, name: true, email: true, level: true } });
}

/** The e2e FirmClient (E2E_CLIENT_CODE), onboarded once on staging, with its CL- site. */
export async function e2eClient(db: PrismaClient, spec?: string) {
  const code = need("E2E_CLIENT_CODE", spec);
  const fc = await db.firmClient.findUniqueOrThrow({ where: { clientCode: code }, include: { client: { select: { name: true } } } });
  expect(fc.clSiteUrl, `${code} needs its CL- site (onboard it once on staging)`).toBeTruthy();
  return fc;
}

export interface FreshJob {
  id: string;
  title: string;
  service: FirmService;
  fy: string;
  period: string;
  clientCode: string;
}

/** A new ASSIGNED JobTask on the e2e client, assignee / reviewer from the env emails, unique title. */
export async function freshJob(
  db: PrismaClient,
  o: { service: FirmService; fy: string; period: string; title: string; assigneeEnv?: E2EVar; reviewerEnv?: E2EVar; internalDueOn?: Date; statutoryDueOn?: Date; spec?: string },
): Promise<FreshJob> {
  const fc = await e2eClient(db, o.spec);
  const assignee = await userByEmail(db, o.assigneeEnv ?? "E2E_ASSIGNEE_EMAIL", o.spec);
  const reviewer = await userByEmail(db, o.reviewerEnv ?? "E2E_REVIEWER_EMAIL", o.spec);
  const title = `${o.title} e2e ${runTag()}`;
  const job = await db.jobTask.create({
    data: {
      firmClientId: fc.id, service: o.service, fy: o.fy, period: o.period, title, state: "ASSIGNED", assigneeId: assignee.id, reviewerId: reviewer.id,
      createdById: assignee.id, internalDueOn: o.internalDueOn ?? null, statutoryDueOn: o.statutoryDueOn ?? null,
      events: { create: { fromState: null, toState: "ASSIGNED", actorId: "system:e2e-setup", note: "created by the e2e spec" } },
    },
  });
  return { id: job.id, title, service: o.service, fy: o.fy, period: o.period, clientCode: fc.clientCode };
}

export async function jobState(db: PrismaClient, id: string): Promise<JobTaskState> {
  return (await db.jobTask.findUniqueOrThrow({ where: { id }, select: { state: true } })).state;
}

/** Poll until the job reaches `state` (the UI confirms first; the row is what counts). */
export async function expectJobState(db: PrismaClient, id: string, state: JobTaskState, timeout = 60_000) {
  await expect.poll(() => jobState(db, id), { timeout, message: `job ${id} → ${state}` }).toBe(state);
}

export async function latestRun(db: PrismaClient, jobTaskId: string) {
  return db.agentRun.findFirstOrThrow({ where: { jobTaskId }, orderBy: { attempt: "desc" }, include: { deliverables: true, checklist: true } });
}

/**
 * Approval copied exactly the run's Working files to Final: same count, same bytes (sha256), every
 * Final in the job's Path A Final folder. Returns the Final rows.
 */
export async function expectFinalMatchesWorking(db: PrismaClient, jobTaskId: string, runId: string, o: { count?: number; finalFolderSuffix?: string } = {}) {
  const all = await db.deliverable.findMany({ where: { jobTaskId } });
  const working = all.filter((d) => d.kind === "Working" && d.agentRunId === runId);
  const final = all.filter((d) => d.kind === "Final");
  if (o.count !== undefined) expect(working, "Working files of the approved run").toHaveLength(o.count);
  expect(working.length).toBeGreaterThan(0);
  expect(final.map((d) => d.sha256).sort(), "Final = byte copies of the approved run's Working files").toEqual(working.map((d) => d.sha256).sort());
  if (o.finalFolderSuffix) expect(final.every((d) => d.spPath.endsWith(o.finalFolderSuffix!)), `Final files under …${o.finalFolderSuffix}`).toBe(true);
  expect(final.every((d) => !!d.driveItemId && d.sizeBytes > 0)).toBe(true);
  return final;
}

/** The job never reached DONE (no DONE event, no doneAt). */
export async function expectNotDone(db: PrismaClient, jobTaskId: string) {
  const row = await db.jobTask.findUniqueOrThrow({ where: { id: jobTaskId }, select: { state: true, doneAt: true } });
  expect(row.state).not.toBe("DONE");
  expect(row.doneAt).toBeNull();
  expect(await db.jobTaskEvent.count({ where: { jobTaskId, toState: "DONE" } })).toBe(0);
}

/** Block-severity failures on a run (a clean fixture must have none). */
export const blockFailures = (run: { checklist: { severity: string; status: string }[] }) => run.checklist.filter((c) => c.severity === "block" && c.status === "fail");

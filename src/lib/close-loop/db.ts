// The narrow, Prisma-shaped client the close loop takes (ADR-005, Phase 8). The real PrismaClient
// satisfies CloseLoopDb (compile-time check in gate.test.ts); tests pass an in-memory fake
// (tests/fakes/close-loop-world.ts). Reads, creates and narrow updates only: nothing here can
// remove a row, and nothing here writes JobTask.state except through transitionJobTask.
import type { FirmService, JobTaskState, Prisma, TuriaSyncStatus } from "@prisma/client";
import type { JobTaskDb, JobTaskTx } from "@/lib/agents/core/state-db";

// ------------------------------------------------------------------ selects

export const JOB_SELECT = {
  id: true,
  state: true,
  service: true,
  fy: true,
  period: true,
  title: true,
  ackRef: true,
  filedAt: true,
  filedById: true,
  doneAt: true,
  assigneeId: true,
  reviewerId: true,
  firmClientId: true,
  updatedAt: true,
  firmClient: { select: { clientCode: true } },
  engagement: { select: { reviewerId: true } },
} as const;

export type CloseJobRow = {
  id: string;
  state: JobTaskState;
  service: FirmService;
  fy: string;
  period: string;
  title: string;
  ackRef: string | null;
  filedAt: Date | null;
  filedById: string | null;
  doneAt: Date | null;
  assigneeId: string | null;
  reviewerId: string | null;
  firmClientId: string;
  updatedAt: Date;
  firmClient: { clientCode: string };
  engagement: { reviewerId: string | null } | null;
};

export const EVENT_SELECT = { id: true, fromState: true, toState: true, actorId: true, note: true, createdAt: true } as const;

export type JobEventRow = {
  id: string;
  fromState: JobTaskState | null;
  toState: JobTaskState;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
};

export const DELIVERABLE_SELECT = {
  id: true,
  kind: true,
  name: true,
  spPath: true,
  driveId: true,
  driveItemId: true,
  sha256: true,
  sizeBytes: true,
  verifiedAt: true,
} as const;

export type DeliverableRow = {
  id: string;
  kind: string;
  name: string;
  spPath: string;
  driveId: string | null;
  driveItemId: string | null;
  sha256: string;
  sizeBytes: number;
  verifiedAt: Date | null;
};

export const SYNC_SELECT = {
  id: true,
  operation: true,
  mode: true,
  status: true,
  turiaRef: true,
  minutesLogged: true,
  confirmedById: true,
  spotChecked: true,
  updatedAt: true,
} as const;

export type TuriaSyncRow = {
  id: string;
  operation: string;
  mode: string;
  status: TuriaSyncStatus;
  turiaRef: string | null;
  minutesLogged: number | null;
  confirmedById: string | null;
  spotChecked: boolean;
  updatedAt: Date;
};

// ------------------------------------------------------------------ where shapes

export type JobListWhere =
  | { state: { in: JobTaskState[] } }
  | { state: JobTaskState; OR: Array<{ doneAt: { gte: Date } } | { doneAt: null } | { updatedAt: { gte: Date } }> };

export type CoachEventData = {
  userId: string;
  kind: "reminder" | "escalation";
  jobTaskId: string;
  payload: Prisma.InputJsonValue;
};

export type AuditEventData = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta?: Prisma.InputJsonValue;
};

// ------------------------------------------------------------------ client

export interface CloseLoopTx extends JobTaskTx {
  jobTask: JobTaskTx["jobTask"] & {
    findFirst(args: { where: { id: string }; select: typeof JOB_SELECT }): PromiseLike<CloseJobRow | null>;
    findMany(args: { where: JobListWhere; select: typeof JOB_SELECT; orderBy: { id: "asc" }; take: number }): PromiseLike<CloseJobRow[]>;
  };
  jobTaskEvent: JobTaskTx["jobTaskEvent"] & {
    findMany(args: { where: { jobTaskId: string }; select: typeof EVENT_SELECT; orderBy: { createdAt: "asc" } }): PromiseLike<JobEventRow[]>;
  };
  deliverable: {
    findMany(args: {
      where: { jobTaskId: string; kind: "Final" };
      select: typeof DELIVERABLE_SELECT;
      orderBy: { createdAt: "asc" };
    }): PromiseLike<DeliverableRow[]>;
    updateMany(args: { where: { id: { in: string[] } }; data: { verifiedAt: Date } }): PromiseLike<{ count: number }>;
  };
  turiaSync: {
    findMany(args: {
      where: { jobTaskId: string; operation: string };
      select: typeof SYNC_SELECT;
      orderBy: { updatedAt: "desc" };
    }): PromiseLike<TuriaSyncRow[]>;
  };
  coachEvent: {
    findFirst(args: {
      where: { userId: string; kind: string; jobTaskId: string; createdAt: { gte: Date } };
      select: { id: true };
    }): PromiseLike<{ id: string } | null>;
    create(args: { data: CoachEventData; select: { id: true } }): PromiseLike<{ id: string }>;
  };
  auditEvent: {
    create(args: { data: AuditEventData; select: { id: true } }): PromiseLike<{ id: string }>;
  };
  user: {
    findUnique(args: { where: { id: string }; select: { managerId: true } }): PromiseLike<{ managerId: string | null } | null>;
    findMany(args: { where: { level: "PARTNER"; active: true }; select: { id: true }; orderBy: { id: "asc" } }): PromiseLike<{ id: string }[]>;
  };
}

export interface CloseLoopDb extends CloseLoopTx {
  $transaction<R>(fn: (tx: CloseLoopTx) => Promise<R>): PromiseLike<R>;
}

/** A JobTaskDb whose "transaction" is the one already open, so transitionJobTask joins it. */
export function joinTransaction(tx: CloseLoopTx): JobTaskDb {
  return { $transaction: (fn) => fn(tx) };
}

// ------------------------------------------------------------------ small reads

export function loadJob(db: CloseLoopTx, jobTaskId: string): PromiseLike<CloseJobRow | null> {
  return db.jobTask.findFirst({ where: { id: jobTaskId }, select: JOB_SELECT });
}

export function loadEvents(db: CloseLoopTx, jobTaskId: string): PromiseLike<JobEventRow[]> {
  return db.jobTaskEvent.findMany({ where: { jobTaskId }, select: EVENT_SELECT, orderBy: { createdAt: "asc" } });
}

export function loadFinalDeliverables(db: CloseLoopTx, jobTaskId: string): PromiseLike<DeliverableRow[]> {
  return db.deliverable.findMany({ where: { jobTaskId, kind: "Final" }, select: DELIVERABLE_SELECT, orderBy: { createdAt: "asc" } });
}

export function loadCloseSyncs(db: CloseLoopTx, jobTaskId: string): PromiseLike<TuriaSyncRow[]> {
  return db.turiaSync.findMany({ where: { jobTaskId, operation: "closeTask" }, select: SYNC_SELECT, orderBy: { updatedAt: "desc" } });
}

export async function audit(db: CloseLoopTx, data: AuditEventData): Promise<void> {
  await db.auditEvent.create({ data, select: { id: true } });
}

/** A plain JSON copy (Dates become ISO strings) for Json columns. */
export const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

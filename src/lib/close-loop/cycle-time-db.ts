// The read behind /admin/firm-os/cycle-time: DONE JobTasks in an IST date range with their event
// history, client code and assignee name, mapped to CycleJob for the pure aggregation in
// cycle-time.ts. The client is injectable so tests need no database. Reads only.
import type { FirmService, JobTaskState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cycleTimes, type CycleJob } from "./cycle-time";

type Row = {
  id: string;
  service: FirmService;
  assigneeId: string | null;
  firmClient: { clientCode: string };
  events: { fromState: JobTaskState | null; toState: JobTaskState; createdAt: Date; note: string | null }[];
};

export interface CycleTimeDb {
  jobTask: {
    findMany(args: {
      where: { state: "DONE"; doneAt: { gte: Date; lt: Date } };
      select: {
        id: true;
        service: true;
        assigneeId: true;
        firmClient: { select: { clientCode: true } };
        events: { select: { fromState: true; toState: true; createdAt: true; note: true }; orderBy: { createdAt: "asc" } };
      };
      orderBy: { doneAt: "asc" };
      take: number;
    }): PromiseLike<Row[]>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true } }): PromiseLike<{ id: string; name: string | null }[]>;
  };
}

/** Enough for a year of a small firm's jobs; the page says when the cap is hit. */
export const MAX_CYCLE_JOBS = 5000;

export async function loadCycleJobs(from: Date, to: Date, db: CycleTimeDb = prisma): Promise<{ jobs: CycleJob[]; capped: boolean }> {
  const rows = await db.jobTask.findMany({
    where: { state: "DONE", doneAt: { gte: from, lt: to } },
    select: {
      id: true,
      service: true,
      assigneeId: true,
      firmClient: { select: { clientCode: true } },
      events: { select: { fromState: true, toState: true, createdAt: true, note: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { doneAt: "asc" },
    take: MAX_CYCLE_JOBS,
  });
  const ids = [...new Set(rows.map((r) => r.assigneeId).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return {
    capped: rows.length >= MAX_CYCLE_JOBS,
    jobs: rows.map((r) => ({
      jobTaskId: r.id,
      service: r.service,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeId ? names.get(r.assigneeId) ?? null : null,
      clientCode: r.firmClient.clientCode,
      times: cycleTimes(r.events),
    })),
  };
}

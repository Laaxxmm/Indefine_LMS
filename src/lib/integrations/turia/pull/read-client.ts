// The read-only Turia client for Firm OS (ADR-003 amendment, owner decision 06 Nov 2026).
//
// It reuses Neo Centra's connection unchanged: the firm-wide Turia sign-in the Neo Centra Chrome
// extension pushes every 5 minutes (NeoTuriaSession, sealed with NEO_TURIA_COOKIE_KEY) and
// `turiaPost` from src/lib/neo-centra/turia.ts. Every call goes through readCall(), which refuses
// anything outside TURIA_READ_ALLOWLIST *before* a request is made. There is no create, update,
// close, assign, log-time or remove call here, and tests/unit/turia-pull-readonly.test.ts fails if
// one appears (allowlist contents, every call site, and no other import of turiaPost under
// src/lib/integrations/turia/pull or the routes that run it).
import { TuriaSessionError, turiaPost } from "@/lib/neo-centra/turia";

export type TuriaPostFn = (endpoint: string, action: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The only Turia calls Firm OS may make. Each one only reads. */
export const TURIA_READ_ALLOWLIST: readonly { endpoint: string; action: string; why: string }[] = Object.freeze([
  { endpoint: "task", action: "list", why: "The task list: the source of every mirrored task (paged, 100 at a time)." },
  { endpoint: "task", action: "get", why: "One task's detail; allowed for diagnosis, not called on a normal run." },
  { endpoint: "utilities", action: "organizationUserListNew", why: "Turia users with email, to match them to the firm's users." },
  { endpoint: "timesheet", action: "list", why: "Time logged on a task Turia shows completed, so the close gate gets real minutes." },
]);

/** Refused before any request: an action outside the read allowlist. */
export class TuriaReadOnlyError extends Error {
  constructor(endpoint: string, action: string) {
    super(`Turia ${endpoint}/${action} is not a read action Firm OS may call`);
    this.name = "TuriaReadOnlyError";
  }
}

export function isReadAction(endpoint: string, action: string): boolean {
  return TURIA_READ_ALLOWLIST.some((a) => a.endpoint === endpoint && a.action === action);
}

export type TuriaUser = { id: string; name: string; email: string | null };

export interface TuriaReader {
  /** One page of task/list, newest first by `sortColumn`. An empty array past the last page. */
  taskPage(page: number, perPage: number, sortColumn: string): Promise<unknown[]>;
  /** Turia's users (id, name, email). Empty when Turia does not answer the call. */
  orgUsers(): Promise<TuriaUser[]>;
  /** Minutes logged on a task (timesheet/list), or null when Turia shows none. */
  taskMinutes(taskId: string): Promise<number | null>;
}

const numf = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** The one gate every Firm OS Turia call passes: anything not on the read allowlist is refused before a request. */
export function turiaRead(post: TuriaPostFn, endpoint: string, action: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isReadAction(endpoint, action)) return Promise.reject(new TuriaReadOnlyError(endpoint, action));
  return post(endpoint, action, data);
}

export function createTuriaReader(post: TuriaPostFn = turiaPost): TuriaReader {
  const readCall = (endpoint: string, action: string, data: Record<string, unknown>) => turiaRead(post, endpoint, action, data);

  return {
    async taskPage(page, perPage, sortColumn) {
      let json: Record<string, unknown>;
      try {
        json = await readCall("task", "list", { page, perPage: Math.min(perPage, 100), sortColumn, sort: "desc", q: "", dashboardFilter: null, userId: null, department: null, orguserid: "" });
      } catch (e) {
        // Turia answers a page past the last one with a 404 instead of an empty list (Neo Centra sees the same).
        if (page > 1 && !(e instanceof TuriaSessionError) && e instanceof Error && /\b404\b/.test(e.message)) return [];
        throw e;
      }
      const wrap = json.tasks as Record<string, unknown> | undefined;
      const rows = wrap?.tasks;
      return Array.isArray(rows) ? rows : [];
    },

    async orgUsers() {
      let json: Record<string, unknown>;
      try {
        json = await readCall("utilities", "organizationUserListNew", {});
      } catch (e) {
        if (e instanceof TuriaSessionError) throw e;
        return []; // people still come from the task rows (names only, matched by name)
      }
      const rows = (json.users ?? json.data ?? []) as unknown;
      if (!Array.isArray(rows)) return [];
      const out: TuriaUser[] = [];
      for (const u of rows as Array<Record<string, unknown>>) {
        const id = String(u?.id ?? u?.userId ?? "").trim();
        if (!id) continue;
        const name = String(u.name ?? u.fullname ?? `${u.firstname ?? ""} ${u.lastname ?? ""}`).replace(/\s+/g, " ").trim();
        const email = String(u.email ?? "").trim().toLowerCase();
        out.push({ id, name, email: email.includes("@") ? email : null });
      }
      return out;
    },

    async taskMinutes(taskId) {
      const json = await readCall("timesheet", "list", { taskId, taskid: taskId });
      const rows = json.tasktimesheets;
      if (!Array.isArray(rows)) return null;
      const hours = (rows as Array<Record<string, unknown>>).reduce((s, r) => s + Math.max(0, numf(r?.totalhours)), 0);
      const minutes = Math.round(hours * 60);
      return minutes > 0 ? minutes : null;
    },
  };
}

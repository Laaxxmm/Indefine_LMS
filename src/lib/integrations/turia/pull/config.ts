// Settings of the Turia pull (ADR-003 amendment). Off by default; FIRM_OS_ENABLED must be on too.
//
//   FIRM_OS_TURIA_PULL       off (default) | dry-run | on
//       off      nothing runs; the cron answers "skipped"
//       dry-run  reads Turia, stores the mirror, the match suggestions and a preview report;
//                creates or changes no job, client or Turia close record
//       on       also creates and updates jobs and records Turia completions for the close gate
//   FIRM_OS_TURIA_PULL_SORT  createdon (default, what Neo Centra uses) | updatedon. With updatedon,
//                a run may stop at an unchanged page, but only when Turia's rows really come back
//                newest-change first and a complete scan ran in the last 24 hours.
import { istWeekday, IST_OFFSET_MS } from "@/lib/ist";

type Env = Record<string, string | undefined>;

export type PullMode = "off" | "dry-run" | "on";

export function turiaPullMode(env: Env = process.env): { mode: PullMode; valid: boolean } {
  const raw = (env.FIRM_OS_TURIA_PULL ?? "").trim().toLowerCase();
  if (!raw || raw === "off" || raw === "false" || raw === "0") return { mode: "off", valid: true };
  if (raw === "dry-run" || raw === "dryrun" || raw === "dry_run") return { mode: "dry-run", valid: true };
  if (raw === "on" || raw === "true" || raw === "1") return { mode: "on", valid: true };
  return { mode: "off", valid: false };
}

export function pullSortColumn(env: Env = process.env): "createdon" | "updatedon" {
  return (env.FIRM_OS_TURIA_PULL_SORT ?? "").trim().toLowerCase() === "updatedon" ? "updatedon" : "createdon";
}

export const PULL_LIMITS = {
  /** Rows per task/list page (Turia accepts more; we stay at 100). */
  perPage: 100,
  /** Pause between pages. */
  pageDelayMs: 400,
  /** Pages per run at most (5,000 tasks). */
  maxPages: 50,
  /** The whole run stops after this, keeping what it did (status "partial"). */
  timeoutMs: 240_000,
  /** One Turia call may take this long before the run stops waiting for it. */
  callTimeoutMs: 30_000,
  /** timesheet/list reads per run (completed tasks only), so a big completion day does not flood Turia. */
  maxMinuteReads: 20,
  /** A completed task with no time logged is checked again after this long. */
  minuteRecheckMs: 24 * 60 * 60 * 1000,
  /** Preview / result rows kept on a run. */
  previewMax: 300,
  /** A Turia sign-in pushed within this long counts as fresh on the admin page. */
  freshSessionMs: 15 * 60 * 1000,
  /** A complete scan within this long lets an updatedon-sorted run stop early. */
  fullScanEveryMs: 24 * 60 * 60 * 1000,
} as const;

export type PullLimits = { -readonly [K in keyof typeof PULL_LIMITS]: number };

/** Cron window: Monday to Saturday, 09:00 to 20:00 IST (the GitHub Action runs every 15 minutes in it). */
export function inPullWindow(now: Date): boolean {
  const wd = istWeekday(now);
  if (wd === 0) return false;
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 20 * 60;
}

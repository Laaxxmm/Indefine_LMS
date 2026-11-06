// What people read about a Turia sync run (admin page, "Sync now", the cron answer). Plain
// sentences: what happened and what to do (tests/unit/plain-language-errors.test.tsx).

export const SESSION_MESSAGE = "Turia could not be read because its sign-in is missing or has expired. Open Turia in Chrome with the Neo Centra extension signed in, then try again.";
export const PULL_OFF_MESSAGE = "The Turia sync is switched off, so nothing was read. Ask IT to set it to dry run first.";
export const MODE_INVALID_MESSAGE = "The Turia sync setting is not one of off, dry run or on, so nothing was read. Ask IT to correct it.";
export const BUSY_MESSAGE = "A Turia sync is already running. Wait a few minutes, then reload this page to see its result.";
export const FAILED_MESSAGE = "The Turia sync stopped because Turia could not be read just now. Nothing was changed after that point. Try again in a few minutes, and tell IT if it keeps happening.";
export const TIMEOUT_MESSAGE = "The Turia sync took too long and stopped part way. What it read is kept; the next run carries on.";
export const OUTSIDE_HOURS_MESSAGE = "The scheduled Turia sync runs Monday to Saturday, 9:00 to 20:00 IST, so nothing was read now.";

/** The one-line result of a finished run. */
export function runResultMessage(r: { mode: "dry-run" | "on"; complete: boolean; fetched: number; changed: number }): string {
  const scan = r.complete ? "the whole task list" : "part of the task list";
  const what = r.mode === "dry-run" ? "Dry run: nothing in Firm OS was changed. Check the preview below." : "Jobs were updated from Turia.";
  return `Read ${scan} from Turia (${r.fetched} tasks, ${r.changed} new or changed). ${what}`;
}

// Pure logic for the side panel and the options page: no chrome.* calls, no network, no DOM.
// Unit-tested from the LMS repo (tests/unit/companion-extension-core.test.ts).
//
// The extension is read-only. It shows the current Firm OS task and offers copy buttons; it never
// reads, fills or submits any web page, and never files, signs, pays or sends anything.

export const TOKEN_PATTERN = /^fosc_[A-Za-z0-9_-]{43}$/;
/** How often the panel refreshes while it is visible. */
export const POLL_MS = 60_000;
/** The longest wait between refreshes while the same task stays on screen. */
export const MAX_POLL_MS = 5 * 60_000;
/** A refresh when the panel becomes visible again is skipped if the last one is this recent. */
export const FRESH_MS = 15_000;

/**
 * Delay before the next automatic refresh. Every minute, except while the panel keeps getting the
 * same task back: each unchanged answer doubles the wait, up to 5 minutes. Any change, an error,
 * the "nothing waiting" view (its text promises a check every minute), Refresh, a new token, or
 * the panel coming back into view starts again at one minute. No refresh runs while it is hidden.
 */
export function nextPollDelay(view, unchanged) {
  if (view !== "task") return POLL_MS;
  return Math.min(POLL_MS * 2 ** Math.max(0, Math.floor(unchanged || 0)), MAX_POLL_MS);
}

/** What identifies the task on screen (the server's timestamp aside), to tell "unchanged" answers. */
export function taskKey(data) {
  return data ? JSON.stringify([data.task ?? null, data.later ?? null, data.counts ?? null]) : "";
}
const MAX_MESSAGE = 300;

/** Every sentence the extension writes itself. Plain words: what is wrong and what to do. */
export const TEXT = {
  notPaired: "This panel is not paired with Firm OS yet. Create a pairing code on the Companion page in Firm OS, then paste it on the Options page.",
  pairingExpired: "Your pairing has expired. Create a new one on the Companion page in Firm OS.",
  noAccess: "The Companion is not turned on for your account. Ask an admin to turn it on in Firm OS.",
  offline: "You appear to be offline, or Firm OS cannot be reached. The panel will try again in a minute.",
  serverError: "Firm OS could not load your task just now. The panel will try again in a minute.",
  busy: "Too many refreshes in a short time. The panel will try again in a minute.",
  caughtUp: "You're all caught up.",
  unexpected: "Firm OS sent an answer this panel does not understand. Update the extension, or ask your admin.",
  badToken: "That does not look like a whole pairing code. Copy it again from the Companion page in Firm OS.",
  noToken: "Paste a pairing code first.",
  noSavedToken: "No pairing code is saved in this browser yet. Paste one above and choose Save and test connection.",
  forgotten: "This browser is no longer paired. To stop the code working everywhere, revoke it on the Companion page in Firm OS.",
};

export function nextTaskUrl(origin) {
  return `${origin}/api/firm-os/companion/next-task`;
}

export function companionPageUrl(origin) {
  return `${origin}/companion`;
}

/** A path from the API joined to the Firm OS origin; null unless it stays on that origin. */
export function jobLink(origin, path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  try {
    const url = new URL(path, origin);
    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

/** The server's sentence when it is a plain, short one; otherwise our own fallback. */
export function cleanMessage(body, fallback) {
  const m = body && typeof body === "object" ? body.error : null;
  if (typeof m !== "string") return fallback;
  const t = m.trim();
  return t && t.length <= MAX_MESSAGE && !/[<>{}]/.test(t) ? t : fallback;
}

/** Just enough shape checking that rendering cannot trip over a surprise. */
export function isTaskResponse(body) {
  if (!body || body.status !== "task" || !body.task || typeof body.task !== "object") return false;
  const t = body.task;
  return (
    typeof t.jobId === "string" &&
    t.job && typeof t.job.title === "string" &&
    Array.isArray(t.steps) && t.steps.every((s) => s && typeof s.n === "number" && typeof s.text === "string") &&
    Array.isArray(t.checklist) &&
    Array.isArray(t.values) && t.values.every((v) => v && typeof v.label === "string" && typeof v.display === "string")
  );
}

/**
 * What to show for a fetch result: { kind: "network" } or { kind: "http", status, body }.
 * Views: task · none · unpaired · pairing · noaccess · offline · busy · error.
 */
export function interpret(result) {
  if (!result || result.kind === "network") return { view: "offline", message: TEXT.offline };
  const { status, body } = result;
  if (status === 304) return { view: "unchanged" };
  if (status === 200) {
    if (isTaskResponse(body)) return { view: "task", data: body };
    if (body && body.status === "none") return { view: "none", message: TEXT.caughtUp };
    return { view: "error", message: TEXT.unexpected };
  }
  if (status === 401) return { view: "pairing", message: cleanMessage(body, TEXT.pairingExpired) };
  if (status === 403) return { view: "noaccess", message: cleanMessage(body, TEXT.noAccess) };
  if (status === 429) return { view: "busy", message: cleanMessage(body, TEXT.busy) };
  return { view: "error", message: TEXT.serverError };
}

/**
 * A 304 answer (the task whose ETag the panel sent is unchanged) becomes the task already on
 * screen. The panel sends If-None-Match only while it shows a task, so a 304 without one is not
 * trusted.
 */
export function resolveUnchanged(next, lastTask) {
  if (next.view !== "unchanged") return next;
  return lastTask ? { view: "task", data: lastTask } : { view: "error", message: TEXT.unexpected };
}

/** Plain label for where a step happens. */
export function whereLabel(where) {
  switch (where) {
    case "files":
      return "Client files";
    case "firm-os":
      return "In Firm OS";
    case "portal":
      return "On the portal: you do this yourself";
    case "offline":
      return "Outside Firm OS: you do this yourself";
    case "turia":
      return "In Turia";
    default:
      return "";
  }
}

/**
 * Local "I've done this step" ticks. They belong to one job and start again when the job changes;
 * they are never sent anywhere.
 */
export function ticksFor(saved, jobId) {
  if (saved && saved.jobId === jobId && Array.isArray(saved.done)) return { jobId, done: saved.done.filter((n) => Number.isInteger(n)) };
  return { jobId, done: [] };
}

export function withTick(ticks, n, on) {
  const done = ticks.done.filter((x) => x !== n);
  if (on) done.push(n);
  done.sort((a, b) => a - b);
  return { jobId: ticks.jobId, done };
}

/** "12:04" in IST for the "Updated" line (the firm works in IST wherever the laptop is). */
export function istTime(date) {
  const ist = new Date(date.getTime() + 330 * 60_000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

export function isTokenShape(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Tidy a pasted token: surrounding spaces, a pasted "Bearer " prefix, line breaks. */
export function tidyToken(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/^Bearer/i, "");
}

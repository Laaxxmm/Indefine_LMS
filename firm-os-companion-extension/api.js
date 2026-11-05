// The extension's only network call: GET the current task from Firm OS. Nothing else in this
// extension fetches anything, and the manifest's content security policy (connect-src) would
// refuse a request to any other host even if it tried.
//
// - one host only: LMS_ORIGIN (config.js), which host_permissions grants
// - GET only, with the pairing token as a Bearer header
// - no cookies (credentials: "omit"), no cache, no referrer, and redirects are refused so an
//   answer can never come from somewhere else
import { LMS_ORIGIN } from "./config.js";
import { nextTaskUrl } from "./core.js";

const TIMEOUT_MS = 15_000;

/** { kind: "http", status, body } or { kind: "network" } when Firm OS could not be reached. */
export async function fetchNextTask(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(nextTaskUrl(LMS_ORIGIN), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { kind: "http", status: res.status, body };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

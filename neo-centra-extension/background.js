// Neo Centra — Turia Cookie Sync (background service worker, ES module)
//
// Reads Turia's HttpOnly accessToken cookie (the page itself can't read it) via chrome.cookies and
// POSTs ONLY that cookie to the Indefine LMS, so Neo Centra's server-side Turia calls stay
// authenticated. The LMS address is pinned at build time (config.js, checked again here) — it is
// not a setting. Pushes on install, every 5 min, and immediately whenever Turia rotates its
// accessToken. Auth to the LMS is a Bearer relay token (set in the popup; must match
// NEO_TURIA_RELAY_TOKEN on the server).
import { LMS_ORIGIN } from "./config.js";
import { checkOrigin } from "./origin.js";

const TURIA_DOMAIN = "practice.turia.in";
const TOKEN_COOKIE = "accessToken";
const SYNC_ALARM = "neoCentraTuriaSync";
const SYNC_INTERVAL_MIN = 5;

/** The pinned LMS origin, or "" if this build carries an address the rule refuses. */
const LMS = checkOrigin(LMS_ORIGIN) || "";

async function getRelayToken() {
  const { relayToken } = await chrome.storage.local.get(["relayToken"]);
  return relayToken || "";
}

/** "accessToken=<value>" — the one cookie the LMS needs. Nothing else from the Turia jar leaves the browser. */
async function accessTokenCookie() {
  const cookies = await chrome.cookies.getAll({ domain: TURIA_DOMAIN, name: TOKEN_COOKIE });
  const token = (cookies || []).find((c) => c.path === "/") || (cookies || [])[0];
  if (!token?.value) return null;
  return `${TOKEN_COOKIE}=${token.value}`;
}

// Nudge Turia with a cheap authenticated call so it rotates the accessToken;
// chrome.cookies.onChanged then fires and triggers a push. Runs against Turia only.
async function keepTuriaSessionAlive() {
  const org = await chrome.cookies.getAll({ domain: TURIA_DOMAIN, name: "activeOrganizationId" });
  const orgId = org?.[0]?.value;
  if (!orgId) return false;
  try {
    const res = await fetch(`https://${TURIA_DOMAIN}/api/task`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "taskListStatusCount", data: { compliance: null, orguserid: "", organizationId: orgId }, organizationId: orgId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function setStatus(s) {
  await chrome.storage.local.set({ lastStatus: { ...s, ts: Date.now() } });
  const [text, color] = s.ok ? ["✓", "#10b981"] : s.reason === "no-token" || s.reason === "no-config" ? ["⚠", "#f59e0b"] : ["!", "#ef4444"];
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function pushCookie() {
  if (!LMS) { await setStatus({ ok: false, reason: "bad-build", msg: "This copy of the extension has an invalid LMS address. Rebuild it with build.mjs." }); return { ok: false, reason: "bad-build" }; }
  const cookie = await accessTokenCookie();
  if (!cookie) { await setStatus({ ok: false, reason: "no-token", msg: "No Turia accessToken — log into practice.turia.in." }); return { ok: false, reason: "no-token" }; }
  const relayToken = await getRelayToken();
  if (!relayToken) { await setStatus({ ok: false, reason: "no-config", msg: "Set the relay token in the popup." }); return { ok: false, reason: "no-config" }; }

  try {
    const res = await fetch(`${LMS}/api/tools/neo-centra/turia-cookie`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${relayToken}` },
      body: JSON.stringify({ cookie }),
      credentials: "omit",
      redirect: "error", // never follow a redirect off the pinned LMS with the token attached
    });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (res.ok && body.ok) { await setStatus({ ok: true, msg: `Pushed ${new Date().toLocaleTimeString()}` }); return { ok: true }; }
    await setStatus({ ok: false, reason: "backend", msg: `LMS ${res.status}: ${body.error || "rejected"}` });
    return { ok: false, status: res.status };
  } catch (e) {
    await setStatus({ ok: false, reason: "network", msg: `Can't reach ${LMS}.` });
    return { ok: false, error: String(e?.message || e) };
  }
}

async function start() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MIN });
  await chrome.storage.local.remove("lmsUrl"); // the old free-text address setting is gone
  await pushCookie();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup?.addListener(start);

chrome.alarms.onAlarm.addListener(async (alarm) => { if (alarm.name !== SYNC_ALARM) return; await keepTuriaSessionAlive(); await pushCookie(); });

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed || !cookie.domain.includes(TURIA_DOMAIN) || cookie.name !== TOKEN_COOKIE) return;
  await pushCookie();
});

// Only this extension's own popup talks to the worker.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender?.id !== chrome.runtime.id) return false;
  if (msg?.type === "SYNC_NOW") { (async () => { await keepTuriaSessionAlive(); respond(await pushCookie()); })(); return true; }
  if (msg?.type === "GET_STATE") { chrome.storage.local.get(["lastStatus", "relayToken"]).then((s) => respond({ ...s, lmsOrigin: LMS })); return true; }
  if (msg?.type === "SET_CONFIG") { chrome.storage.local.set({ relayToken: String(msg.relayToken || "") }).then(() => respond({ ok: true })); return true; }
  return false;
});

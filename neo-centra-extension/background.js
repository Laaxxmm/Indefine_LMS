// Neo Centra — Turia Cookie Sync (background service worker)
//
// Reads practice.turia.in cookies — including the HttpOnly accessToken the page
// itself can't read — via chrome.cookies, and POSTs the Cookie header to the
// Indefine LMS so Neo Centra's server-side Turia calls stay authenticated.
// Pushes on install, every 5 min, and immediately whenever Turia rotates its
// accessToken. Auth to the LMS is a Bearer relay token (set in the popup; must
// match NEO_TURIA_RELAY_TOKEN on the server).

const TURIA_DOMAIN = "practice.turia.in";
const SYNC_ALARM = "neoCentraTuriaSync";
const SYNC_INTERVAL_MIN = 5;

async function getConfig() {
  const { lmsUrl, relayToken } = await chrome.storage.local.get(["lmsUrl", "relayToken"]);
  const url = (lmsUrl || "").replace(/\/$/, "");
  // Never send the cookie or the relay token over plain http.
  return { lmsUrl: /^https:\/\//.test(url) ? url : "", relayToken: relayToken || "" };
}

async function buildCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: TURIA_DOMAIN });
  if (!cookies?.length) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// Nudge Turia with a cheap authenticated call so it rotates the accessToken;
// chrome.cookies.onChanged then fires and triggers a push.
async function keepTuriaSessionAlive() {
  const cookies = await chrome.cookies.getAll({ domain: TURIA_DOMAIN });
  const orgId = cookies.find((c) => c.name === "activeOrganizationId")?.value;
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
  const [text, color] = s.ok ? ["✓", "#10b981"] : s.reason === "no-token" || s.reason === "no-cookies" || s.reason === "no-config" ? ["⚠", "#f59e0b"] : ["!", "#ef4444"];
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function pushCookie() {
  const cookieHeader = await buildCookieHeader();
  if (!cookieHeader) { await setStatus({ ok: false, reason: "no-cookies", msg: "No Turia cookies. Log into practice.turia.in." }); return { ok: false, reason: "no-cookies" }; }
  if (!cookieHeader.includes("accessToken=")) { await setStatus({ ok: false, reason: "no-token", msg: "No accessToken — log into Turia." }); return { ok: false, reason: "no-token" }; }

  const { lmsUrl, relayToken } = await getConfig();
  if (!lmsUrl || !relayToken) { await setStatus({ ok: false, reason: "no-config", msg: "Set the LMS URL and relay token in the popup." }); return { ok: false, reason: "no-config" }; }

  try {
    const res = await fetch(`${lmsUrl}/api/tools/neo-centra/turia-cookie`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${relayToken}` },
      body: JSON.stringify({ cookie: cookieHeader }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (res.ok && body.ok) { await setStatus({ ok: true, msg: `Pushed ${new Date().toLocaleTimeString()}` }); return { ok: true }; }
    await setStatus({ ok: false, reason: "backend", msg: `LMS ${res.status}: ${body.error || "rejected"}` });
    return { ok: false, status: res.status };
  } catch (e) {
    await setStatus({ ok: false, reason: "network", msg: `Can't reach ${lmsUrl}.` });
    return { ok: false, error: String(e?.message || e) };
  }
}

chrome.runtime.onInstalled.addListener(async () => { chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MIN }); await pushCookie(); });
chrome.runtime.onStartup?.addListener(async () => { chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MIN }); await pushCookie(); });

chrome.alarms.onAlarm.addListener(async (alarm) => { if (alarm.name !== SYNC_ALARM) return; await keepTuriaSessionAlive(); await pushCookie(); });

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed || !cookie.domain.includes(TURIA_DOMAIN) || cookie.name !== "accessToken") return;
  await pushCookie();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === "SYNC_NOW") { (async () => { await keepTuriaSessionAlive(); respond(await pushCookie()); })(); return true; }
  if (msg?.type === "GET_STATE") { chrome.storage.local.get(["lastStatus", "lmsUrl", "relayToken"]).then(respond); return true; }
  if (msg?.type === "SET_CONFIG") { chrome.storage.local.set({ lmsUrl: msg.lmsUrl, relayToken: msg.relayToken }).then(() => respond({ ok: true })); return true; }
});

// Statutory Updates Collector (background service worker)
//
// Once a day (first check after 07:00 IST with Chrome open) it opens each of the six
// portals that refuse non-Indian IPs in a background tab, runs the statutory-updates
// skill's collector in the page (collectors.js), reads each post's document from the
// page, and pushes everything to the LMS: POST /api/tools/statutory/ingest with
// Authorization: Bearer <relay token> (must match STATUTORY_RELAY_TOKEN on the server).
// Window = the last 7 IST days; the LMS de-duplicates, so overlaps are free.

const LMS_URL = "https://lms.indefine.in";
const CHECK_ALARM = "statutoryCheck";
const RUN_AFTER_IST_HOUR = 7;
const CHUNK = 3; // posts per request (PDFs travel as base64)

const PORTALS = [
  { portal: "Income Tax (CBDT)", url: "https://www.incometaxindia.gov.in/" },
  { portal: "GST – CBIC", url: "https://taxinformation.cbic.gov.in/" },
  { portal: "GST – GSTN", url: "https://www.gst.gov.in/newsandupdates", settleMs: 4000 },
  { portal: "MCA", url: "https://www.mca.gov.in/content/mca/global/en/home.html", settleMs: 4000 },
  { portal: "EPFO", url: "https://www.epfo.gov.in/" },
  { portal: "ESIC", url: "https://esic.gov.in/circulars" },
];

const istDay = (days = 0) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);
const istHour = () => new Date(Date.now() + 330 * 60000).getUTCHours();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTab(url, settleMs = 1500) {
  const tab = await chrome.tabs.create({ url, active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpd); reject(new Error("page did not load in 90 s")); }, 90000);
    function onUpd(id, info) {
      if (id === tab.id && info.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
  });
  await sleep(settleMs);
  return tab.id;
}

async function inPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return res?.result;
}

async function push(body) {
  const { relayToken } = await chrome.storage.local.get("relayToken");
  if (!relayToken) throw new Error("Set the relay token in the extension popup.");
  const res = await fetch(`${LMS_URL}/api/tools/statutory/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${relayToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LMS ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// GSTN news is rendered client-side: read each post from its own page.
async function gstnText(url) {
  const tabId = await openTab(url, 4000);
  try {
    return await inPage(tabId, () => {
      const main = document.querySelector("main, .content, #content") || document.body;
      return main.innerText.replace(/\s+/g, " ").trim().slice(0, 1800);
    });
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function collectPortal({ portal, url, settleMs }, from, to) {
  let tabId;
  let items = [];
  try {
    tabId = await openTab(url, settleMs);
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["collectors.js"] });
    items = await inPage(tabId, (p, f, t) => window.__statutory.collect(p, f, t), [portal, from, to]);
    if (!Array.isArray(items)) throw new Error("collector returned nothing — has the portal changed its site?");
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const docs = portal === "GST – GSTN"
        ? await Promise.all(chunk.map(async (x) => ({ text: x.url ? await gstnText(x.url).catch(() => null) : null })))
        : await inPage(tabId, (s, c) => window.__statutory.payloads(s, c), [i, CHUNK]);
      const last = i + CHUNK >= items.length;
      await push({
        portal,
        items: chunk.map((x, k) => ({ ...x, ...(docs?.[k] || {}) })),
        ...(last ? { done: { ok: true, fetched: items.length, inRange: items.length } } : {}),
      });
    }
    if (!items.length) await push({ portal, items: [], done: { ok: true, fetched: 0, inRange: 0 } });
    return { portal, ok: true, count: items.length };
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200);
    await push({ portal, items: [], done: { ok: false, error, fetched: 0, inRange: 0 } }).catch(() => {});
    return { portal, ok: false, error };
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

let running = false;
async function runAll(reason) {
  if (running) return { ok: false, error: "already running" };
  running = true;
  // A service worker idles out after 30 s without extension API calls; keep it awake.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  const from = istDay(-6), to = istDay(0);
  await chrome.storage.local.set({ lastRun: { state: "running", reason, from, to, ts: Date.now() } });
  const results = [];
  try {
    for (const p of PORTALS) results.push(await collectPortal(p, from, to));
  } finally {
    clearInterval(keepAlive);
    running = false;
  }
  const allOk = results.every((r) => r.ok);
  await chrome.storage.local.set({ lastRun: { state: "done", reason, from, to, ts: Date.now(), results }, lastRunDay: istDay(0) });
  chrome.action.setBadgeText({ text: allOk ? "✓" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: allOk ? "#10b981" : "#ef4444" });
  return { ok: allOk, results };
}

async function maybeRun() {
  const { lastRunDay } = await chrome.storage.local.get("lastRunDay");
  if (lastRunDay !== istDay(0) && istHour() >= RUN_AFTER_IST_HOUR) await runAll("daily");
}

const schedule = () => chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === CHECK_ALARM) maybeRun(); });

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === "RUN_NOW") { runAll("manual").then(respond); return true; }
  if (msg?.type === "GET_STATE") { chrome.storage.local.get(["lastRun", "relayToken"]).then((s) => respond({ lastRun: s.lastRun, hasToken: !!s.relayToken, running })); return true; }
  if (msg?.type === "SET_TOKEN") { chrome.storage.local.set({ relayToken: msg.relayToken }).then(() => respond({ ok: true })); return true; }
});

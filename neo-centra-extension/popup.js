const statusEl = document.getElementById("status");
const lmsEl = document.getElementById("lmsUrl");
const tokenEl = document.getElementById("relayToken");
const saveBtn = document.getElementById("save");
const syncBtn = document.getElementById("sync");

function renderStatus(s) {
  if (!s) { statusEl.textContent = 'Not synced yet. Set the LMS URL + token, then "Sync now".'; statusEl.className = "status neutral"; return; }
  const stamp = s.ts ? ` · ${new Date(s.ts).toLocaleTimeString()}` : "";
  statusEl.textContent = s.msg + stamp;
  statusEl.className = "status " + (s.ok ? "ok" : s.reason === "no-cookies" || s.reason === "no-token" || s.reason === "no-config" ? "warn" : "bad");
}

async function loadState() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  lmsEl.value = state?.lmsUrl || "https://lms.indefine.in";
  tokenEl.value = state?.relayToken || "";
  renderStatus(state?.lastStatus);
}

saveBtn.addEventListener("click", async () => {
  const lmsUrl = lmsEl.value.trim().replace(/\/$/, "");
  const relayToken = tokenEl.value.trim();
  if (!/^https?:\/\//.test(lmsUrl)) { renderStatus({ ok: false, msg: "LMS URL must start with http(s)://" }); return; }
  if (!relayToken) { renderStatus({ ok: false, reason: "no-config", msg: "Enter the relay token." }); return; }
  await chrome.runtime.sendMessage({ type: "SET_CONFIG", lmsUrl, relayToken });
  renderStatus({ ok: true, msg: "Saved. Click Sync now.", ts: Date.now() });
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
  await loadState();
  syncBtn.disabled = false;
  syncBtn.textContent = "Sync now";
});

loadState();

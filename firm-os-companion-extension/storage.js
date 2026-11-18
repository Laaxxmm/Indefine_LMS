// What the extension keeps in the browser, and nothing more:
//   chrome.storage.local    pairingToken — the token pasted on the Options page
//   chrome.storage.session  stepTicks — { jobId, done: [step numbers] } for the current job only;
//                           cleared when the browser closes, started again when the job changes
// No task, client or amount is ever written to storage; the panel keeps those in memory only.

export async function readToken() {
  const { pairingToken } = await chrome.storage.local.get("pairingToken");
  return typeof pairingToken === "string" ? pairingToken : "";
}

export async function saveToken(token) {
  await chrome.storage.local.set({ pairingToken: token });
}

/** "Forget this pairing" on the Options page: the stored token is blanked. */
export async function forgetToken() {
  await chrome.storage.local.set({ pairingToken: "" });
}

export async function readTicks() {
  const { stepTicks } = await chrome.storage.session.get("stepTicks");
  return stepTicks ?? null;
}

export async function saveTicks(ticks) {
  await chrome.storage.session.set({ stepTicks: ticks });
}

/** Calls `fn` when the stored token changes (pasted or forgotten on the Options page). */
export function onTokenChange(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "pairingToken" in changes) fn();
  });
}

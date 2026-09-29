const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

async function render() {
  const s = await send({ type: "GET_STATE" });
  $("token").placeholder = s.hasToken ? "token saved — paste to replace" : "same as STATUTORY_RELAY_TOKEN on the LMS";
  $("run").disabled = s.running || !s.hasToken;
  const r = s.lastRun;
  const el = $("state");
  el.textContent = "";
  if (!r) { el.textContent = "Not run yet."; return; }
  const head = document.createElement("div");
  head.className = "muted";
  head.textContent = `${r.state === "running" ? "Running" : "Last run"} ${new Date(r.ts).toLocaleString()} · ${r.from} to ${r.to} (${r.reason})`;
  el.append(head);
  const ul = document.createElement("ul");
  for (const x of r.results || []) {
    const li = document.createElement("li");
    li.className = x.ok ? "ok" : "bad";
    li.textContent = x.ok ? `${x.portal}: ${x.count} post(s)` : `${x.portal}: FAILED — ${x.error}`;
    ul.append(li);
  }
  el.append(ul);
}

$("save").onclick = async () => {
  const relayToken = $("token").value.trim();
  if (!relayToken) return;
  await send({ type: "SET_TOKEN", relayToken });
  $("token").value = "";
  render();
};
$("run").onclick = async () => {
  $("run").disabled = true;
  const poll = setInterval(render, 3000);
  await send({ type: "RUN_NOW" });
  clearInterval(poll);
  render();
};
render();

// Options page: paste the pairing token (kept in chrome.storage.local), test the connection, or
// forget the pairing. The test is the same read-only GET the side panel makes.
import { fetchNextTask } from "./api.js";
import { LMS_ORIGIN } from "./config.js";
import { TEXT, companionPageUrl, interpret, isTokenShape, tidyToken } from "./core.js";
import { forgetToken, readToken, saveToken } from "./storage.js";

const form = document.getElementById("pair-form");
const input = document.getElementById("token");
const result = document.getElementById("result");
const testBtn = document.getElementById("test");
const forgetBtn = document.getElementById("forget");
const saveBtn = document.getElementById("save");

document.getElementById("origin").textContent = LMS_ORIGIN;
document.getElementById("companion-page").setAttribute("href", companionPageUrl(LMS_ORIGIN));

function report(kind, text) {
  const box = document.createElement("div");
  box.className = `notice notice-${kind}`;
  const p = document.createElement("p");
  p.textContent = text;
  box.append(p);
  result.replaceChildren(box);
}

function busy(on) {
  for (const b of [saveBtn, testBtn, forgetBtn]) b.disabled = on;
}

async function test(token) {
  busy(true);
  try {
    const next = interpret(await fetchNextTask(token));
    if (next.view === "task") {
      const { job } = next.data.task;
      report("ok", `Connected. Your current task is ${job.title} for ${job.clientName}. Open the side panel from the toolbar icon to see its steps.`);
    } else if (next.view === "none") {
      report("ok", `Connected. ${TEXT.caughtUp}`);
    } else {
      report(next.view === "offline" || next.view === "busy" ? "warn" : "bad", next.message);
    }
  } finally {
    busy(false);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = tidyToken(input.value);
  if (!token) return report("warn", TEXT.noToken);
  if (!isTokenShape(token)) return report("bad", TEXT.badToken);
  await saveToken(token);
  input.value = "";
  input.placeholder = "Saved. Paste a new token to replace it.";
  await test(token);
});

testBtn.addEventListener("click", async () => {
  const token = await readToken();
  if (!token) return report("warn", TEXT.notPaired);
  await test(token);
});

forgetBtn.addEventListener("click", async () => {
  await forgetToken();
  input.placeholder = "";
  report("ok", "This browser is no longer paired. To stop the token working everywhere, revoke it on the Companion page in Firm OS.");
});

readToken().then((t) => {
  if (t) input.placeholder = "Saved. Paste a new token to replace it.";
});

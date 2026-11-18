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

const LABELS = new Map([saveBtn, testBtn, forgetBtn].map((b) => [b, b.textContent]));

/** Disable the buttons while a test runs; the one pressed says what is happening. */
function busy(on, pressed) {
  for (const b of [saveBtn, testBtn, forgetBtn]) {
    b.disabled = on;
    b.textContent = on && b === pressed ? "Testing the connection…" : LABELS.get(b);
  }
  if (on) report("info", "Testing the connection to Firm OS…");
}

async function test(token, pressed) {
  busy(true, pressed);
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
  input.placeholder = "Saved. Paste a new code to replace it.";
  await test(token, saveBtn);
});

testBtn.addEventListener("click", async () => {
  const token = await readToken();
  if (!token) return report("warn", TEXT.noSavedToken);
  await test(token, testBtn);
});

forgetBtn.addEventListener("click", async () => {
  await forgetToken();
  input.placeholder = "";
  report("ok", TEXT.forgotten);
});

readToken().then((t) => {
  if (t) input.placeholder = "Saved. Paste a new code to replace it.";
});

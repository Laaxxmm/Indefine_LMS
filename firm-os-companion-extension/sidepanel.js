// Side panel: the current Firm OS task, its SOP steps, a short checklist and copy buttons.
// Refreshes on open, on the Refresh button, when the token changes, when the panel becomes visible
// again and every minute while it is visible — spaced out up to 5 minutes while the same task keeps
// coming back (nextPollDelay in core.js), and not at all while the panel is hidden. Everything is
// built with DOM methods and textContent; no server text is ever parsed as HTML. Ticks are local
// only (storage.js) and never sent.
import { fetchNextTask } from "./api.js";
import { LMS_ORIGIN } from "./config.js";
import { FRESH_MS, TEXT, companionPageUrl, interpret, istTime, jobLink, nextPollDelay, taskKey, ticksFor, whereLabel, withTick } from "./core.js";
import { onTokenChange, readTicks, readToken, saveTicks } from "./storage.js";

const view = document.getElementById("view");
const status = document.getElementById("status");
const announce = document.getElementById("announce");
const refreshBtn = document.getElementById("refresh");

let lastTask = null; // the last task shown, kept in memory only (offline keeps it on screen)
let lastRefresh = 0;
let lastUpdated = ""; // IST time of the last good answer
let inFlight = false;
let renderedKey = ""; // the task on screen; a poll that brings the same task leaves the page alone
let laterOpen = false; // whether "Later" is unfolded, kept across refreshes
let timer = null; // the next automatic refresh
let lastView = ""; // the view the last answer gave
let lastTaskKey = ""; // the task the last answer carried (taskKey)
let unchanged = 0; // answers in a row that brought the same task

// ---------------------------------------------------------------- tiny DOM helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

/** Replace the view; keyboard focus returns to the same control (by id) when it is still there. */
function show(...nodes) {
  const focusedId = view.contains(document.activeElement) ? document.activeElement.id : "";
  view.replaceChildren(...nodes.filter(Boolean));
  view.setAttribute("aria-busy", "false");
  renderedKey = "";
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function say(text) {
  announce.textContent = "";
  setTimeout(() => (announce.textContent = text), 50);
}

function setStatus(text, warn = false) {
  status.textContent = text;
  status.className = warn ? "status warn" : "status";
}

const openOptions = () => chrome.runtime.openOptionsPage();
const companionLink = () => el("a", { href: companionPageUrl(LMS_ORIGIN), target: "_blank", rel: "noopener noreferrer" }, "Open the Companion page in Firm OS");

// ---------------------------------------------------------------- states

function notice(kind, message, ...actions) {
  return el("div", { class: `notice notice-${kind}` }, el("p", { text: message }), actions.length ? el("div", { class: "actions" }, ...actions) : null);
}

function renderUnpaired() {
  show(notice("warn", TEXT.notPaired, el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: openOptions }, "Open Options"), companionLink()));
}

function renderPairing(message) {
  show(notice("warn", message, companionLink(), el("button", { type: "button", class: "btn btn-sm", onclick: openOptions }, "Paste a new pairing code")));
}

function renderMessage(kind, message) {
  show(notice(kind, message));
}

function renderNone(message) {
  show(el("div", { class: "card" }, el("p", { class: "title", text: message }), el("p", { class: "meta", text: "Nothing is waiting for you in Firm OS. The panel checks again every minute while it is open." })));
}

// ---------------------------------------------------------------- the task

function copyButton(value) {
  const btn = el("button", { type: "button", id: `copy-${value.key}`, class: "btn btn-sm", "aria-label": `Copy ${value.label}` }, "Copy");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value.copy);
      btn.textContent = "Copied";
      say(`${value.label} copied.`);
    } catch {
      // Clipboard refused: select the value so the person can press Ctrl+C themselves.
      const code = btn.parentElement?.querySelector("code");
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      btn.textContent = "Selected: press Ctrl+C";
      say(`Copying was blocked. ${value.label} is selected; press Ctrl+C to copy it.`);
    }
    setTimeout(() => (btn.textContent = "Copy"), 2500);
  });
  return btn;
}

function stepItem(step, ticks, jobId) {
  const local = ticks.done.includes(step.n);
  const cls = ["step", step.current ? "step-current" : "", step.done || local ? "step-done" : ""].filter(Boolean).join(" ");
  const where = whereLabel(step.where);
  const body = el(
    "div",
    {},
    step.current ? el("p", { class: "step-badge", text: "You are here" }) : null,
    el("p", { class: "step-text", text: step.text }),
    step.done
      ? el("p", { class: "step-where", text: where ? `${where} · Done` : "Done" })
      : where
        ? el("p", { class: `step-where${step.where === "portal" || step.where === "offline" ? " portal" : ""}`, text: where })
        : null,
  );
  if (!step.done) {
    const id = `tick-${step.n}`;
    const box = el("input", { type: "checkbox", id });
    box.checked = local;
    box.addEventListener("change", async () => {
      const next = withTick(ticksFor(await readTicks(), jobId), step.n, box.checked);
      await saveTicks(next);
      box.closest("li")?.classList.toggle("step-done", box.checked);
      say(box.checked ? `Step ${step.n} ticked. This stays in this browser only.` : `Step ${step.n} unticked.`);
    });
    body.append(el("label", { class: "tick", for: id }, box, "I've done this step"));
  }
  return el("li", { class: cls, "aria-current": step.current ? "step" : null }, el("span", { class: "step-n", text: `${step.n}.` }), body);
}

async function renderTask(data, stale) {
  const { task, later, counts } = data;
  // The minute poll usually brings the same task: leave the page (focus, selection, "Copied") alone.
  const key = JSON.stringify([task, later, counts, stale]);
  if (key === renderedKey) return;
  const saved = await readTicks().catch(() => null);
  const ticks = ticksFor(saved, task.jobId);
  if (!saved || saved.jobId !== task.jobId) await saveTicks(ticks).catch(() => {}); // a new job starts with no ticks

  const due = [task.due.internal ? `Internal due ${task.due.internal}` : null, task.due.statutory ? `Statutory due ${task.due.statutory}` : null].filter(Boolean).join(" · ");
  const href = jobLink(LMS_ORIGIN, task.link?.path);
  const head = el(
    "section",
    { class: "card", "aria-labelledby": "task-title" },
    el("p", { class: "eyebrow" }, "Current task ", task.due.overdue ? el("span", { class: "chip chip-overdue" }, "Overdue") : null, " ", el("span", { class: "chip", title: "Job state in Firm OS" }, task.job.state)),
    el("h1", { class: "title", id: "task-title", text: `${task.job.title} · ${task.job.period}` }),
    el("p", { class: "client", text: `${task.job.clientName} (${task.job.clientCode})` }),
    el("p", { class: "meta", text: [`${task.job.serviceLabel} · FY ${task.job.fy}`, `Your part: ${task.part}`].join(" · ") }),
    due ? el("p", { class: "meta", text: due }) : null,
    el("p", { class: "why", text: task.why }),
    el("p", { class: "next", text: task.nextAction }),
    href ? el("a", { id: "open-job", class: "btn btn-primary btn-block", href, target: "_blank", rel: "noopener noreferrer" }, task.link.label || "Open in Firm OS") : null,
  );

  const steps = el(
    "section",
    { class: "card", "aria-labelledby": "steps-title" },
    el("h2", { class: "section-title", id: "steps-title", text: `Steps · you are on step ${task.currentStep} of ${task.steps.length}` }),
    el("ol", { class: "steps" }, ...task.steps.map((s) => stepItem(s, ticks, task.jobId))),
    el("p", { class: "fine", text: "Ticks stay in this browser and start again for the next job. They do not change anything in Firm OS." }),
  );

  const checklist = task.checklist.length
    ? el("section", { class: "card", "aria-labelledby": "check-title" }, el("h2", { class: "section-title", id: "check-title", text: "Before you move on" }), el("ul", { class: "checklist" }, ...task.checklist.map((c) => el("li", { text: c }))))
    : null;

  const values = task.values.length
    ? el(
        "section",
        { class: "card", "aria-labelledby": "values-title" },
        el("h2", { class: "section-title", id: "values-title", text: "Values to paste yourself" }),
        el(
          "dl",
          { class: "values" },
          ...task.values.map((v) =>
            el("div", { class: "value" }, el("dt", { text: v.label }), el("dd", {}, el("code", { text: v.display }), typeof v.copy === "string" ? copyButton(v) : null, v.note ? el("span", { class: "note", text: v.note }) : null)),
          ),
        ),
      )
    : null;

  const laterList = Array.isArray(later) && later.length
    ? el(
        "section",
        { class: "card" },
        el(
          "details",
          { open: laterOpen, ontoggle: (e) => (laterOpen = e.currentTarget.open) },
          el("summary", { id: "later-summary", text: `Later (${counts.open - 1} more${counts.overdue ? `, ${counts.overdue} overdue in all` : ""})` }),
          el(
            "ul",
            { class: "later" },
            ...later.map((l) => el("li", {}, el("span", { text: l.title }), " ", l.overdue ? el("span", { class: "chip chip-overdue" }, "Overdue") : null, el("p", { class: "meta", text: [l.clientName, l.period, l.due ? `due ${l.due}` : null].filter(Boolean).join(" · ") }))),
          ),
        ),
      )
    : null;

  show(stale ? notice("warn", TEXT.offline) : null, head, steps, checklist, values, laterList);
  renderedKey = key;
}

// ---------------------------------------------------------------- refresh loop

/** One timer: the next automatic refresh, only while the panel is visible. */
function schedule() {
  clearTimeout(timer);
  timer = null;
  if (document.visibilityState !== "visible") return;
  timer = setTimeout(() => refresh(), nextPollDelay(lastView, unchanged));
}

/** Count answers that bring back the same task; anything else starts the one-minute rhythm again. */
function noteAnswer(next) {
  const key = next.view === "task" ? taskKey(next.data) : "";
  unchanged = next.view === "task" && lastView === "task" && key === lastTaskKey ? unchanged + 1 : 0;
  lastView = next.view;
  lastTaskKey = key;
}

/** A person asked for it (Refresh, a new token, back online): fresh rhythm. */
function refreshNow() {
  unchanged = 0;
  return refresh();
}

async function refresh() {
  if (inFlight) return;
  inFlight = true; // guards against overlapping refreshes; Refresh stays enabled so keyboard focus never drops
  view.setAttribute("aria-busy", "true");
  try {
    const token = await readToken();
    if (!token) {
      lastTask = null;
      lastView = "";
      setStatus("");
      renderUnpaired();
      return;
    }
    const result = navigator.onLine === false ? { kind: "network" } : await fetchNextTask(token);
    const next = interpret(result);
    lastRefresh = Date.now();
    noteAnswer(next);
    switch (next.view) {
      case "task":
        lastTask = next.data;
        lastUpdated = istTime(new Date());
        setStatus(`Updated ${lastUpdated} IST`);
        await renderTask(next.data, false);
        break;
      case "none":
        lastTask = null;
        setStatus(`Updated ${istTime(new Date())} IST`);
        renderNone(next.message);
        break;
      case "offline":
        // The notice says what is wrong; the status line says how old the task on screen is.
        setStatus(lastTask ? `Showing the task as it was at ${lastUpdated} IST.` : "", true);
        if (lastTask) await renderTask(lastTask, true);
        else renderMessage("warn", next.message);
        break;
      case "pairing":
        lastTask = null;
        setStatus("");
        renderPairing(next.message);
        break;
      case "noaccess":
        lastTask = null;
        setStatus("");
        renderMessage("bad", next.message);
        break;
      default:
        // Busy or a server error: keep the last task on screen with the message above it.
        setStatus(lastTask ? next.message : "", true);
        if (lastTask) await renderTask(lastTask, false);
        else renderMessage("warn", next.message);
    }
  } finally {
    inFlight = false;
    view.setAttribute("aria-busy", "false");
    schedule();
  }
}

refreshBtn.addEventListener("click", () => {
  refreshNow().then(() => say("Refreshed."));
});
document.getElementById("open-options").addEventListener("click", openOptions);
onTokenChange(() => refreshNow());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return schedule(); // hidden: no timer at all
  unchanged = 0;
  if (Date.now() - lastRefresh > FRESH_MS) refresh();
  else schedule();
});
window.addEventListener("online", () => refreshNow());

refresh();

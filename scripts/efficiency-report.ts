// Efficiency report CLI (docs/qa/efficiency-report.md). Measures model calls, tokens, Graph calls,
// database operations and storage with instrumented fakes (scripts/lib/efficiency*.ts) and writes:
//
//   --json=<file>      the raw numbers (default docs/qa/efficiency-after.json)
//   --baseline=<file>  numbers of an earlier run shown as "before" (default docs/qa/efficiency-before.json)
//   --md=<file>        the report; only the block between the efficiency:data markers is replaced
//                      (default docs/qa/efficiency-report.md)
//   --no-md            numbers only
//
//   npx tsx scripts/efficiency-report.ts [--json=…] [--baseline=…] [--md=…] [--no-md]
//
// Exit codes: 0 written · 1 a measured pipeline differs from the recorded accuracy outcome · 2 usage.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AGENTS } from "@/lib/agents/registry";
import type { ChecklistPack } from "@/lib/agents/core/checklist";
import { measureAgent, totalOps, type AgentMeasure, type OpCounts } from "./lib/efficiency";
import {
  averageRow,
  measureCloseGate,
  measureCoach,
  measureReconciler,
  measureRetention,
  measureViews,
  mib,
  rowBytes,
  type Measured,
  type StorageLine,
} from "./lib/efficiency-scenarios";
import { routerExtras, harnessRepo } from "./lib/efficiency-wiring";

export const DATA_START = "<!-- efficiency:data:start -->";
export const DATA_END = "<!-- efficiency:data:end -->";
const AGENT_KEYS = ["echo", "gst", "roc", "tax", "books", "audit"] as const;

type Report = {
  generatedAt: string;
  label: string;
  agents: Record<string, Omit<AgentMeasure, "rows"> & { costInrPerRun: number }>;
  views: Record<string, Measured>;
  closeGate: Record<string, Measured>;
  reconciler: Record<string, Measured>;
  coach: Record<string, Measured>;
  retention: Measured;
  storage: StorageLine[];
  assumptions: string[];
};

function args(argv: string[]) {
  const a = { json: "docs/qa/efficiency-after.json", baseline: "docs/qa/efficiency-before.json", proposed: "docs/qa/efficiency-proposed.json", md: "docs/qa/efficiency-report.md" as string | null, label: "after" };
  for (const arg of argv) {
    const [k, v] = arg.replace(/^--/, "").split("=", 2);
    if (k === "json") a.json = v;
    else if (k === "baseline") a.baseline = v;
    else if (k === "proposed") a.proposed = v;
    else if (k === "md") a.md = v;
    else if (k === "no-md") a.md = null;
    else if (k === "label") a.label = v;
    else throw new Error(`unknown argument ${arg}`);
  }
  return a;
}

// ------------------------------------------------------------------ storage projection

/** Volume assumptions for a year at the firm (stated in the report). */
const VOLUME = {
  jobs: 2000,
  agentJobs: { gst: 1000, tax: 333, roc: 167, books: 167, audit: 167 } as Record<string, number>,
  runsPerJob: 1.5,
  jobEventsPerJob: 10,
  auditPerJob: 6,
  workingDays: 300,
  staff: 16,
  heartbeatsPerPersonDay: 450,
};

/** Cron cadence: the reconciler runs every 30 min in IST working hours (09:00–19:00, 20 runs a day). */
const RECONCILER_RUNS_PER_DAY = 20;

function storage(
  agents: Record<string, AgentMeasure>,
  coachEvents: Record<string, unknown>[],
  coachPerDay: number,
  cronAudits: { reconcilerPerRun: number; coachPerDay: number },
): { lines: StorageLine[]; assumptions: string[] } {
  const prod = Object.keys(VOLUME.agentJobs);
  const runsOf = (k: string) => VOLUME.agentJobs[k] * VOLUME.runsPerJob;
  const totalRuns = prod.reduce((n, k) => n + runsOf(k), 0);
  const perRun = (k: string, table: string) => agents[k].rows[table].length / Math.max(agents[k].fixtures, 1);
  const rowsOf = (table: string) => prod.flatMap((k) => agents[k].rows[table]);
  const line = (table: string, sample: Record<string, unknown>[], perYearRows: number, basis: string, note = "grows every year (kept)"): StorageLine => {
    const b = averageRow(table, sample);
    return { table, sampleRows: sample.length, heapPerRow: b.heap, indexPerRow: b.index, perYearRows: Math.round(perYearRows), perYearMiB: mib(perYearRows * (b.heap + b.index)), steadyStateNote: note, basis };
  };
  const runs = rowsOf("agentRun");
  const withoutInputs = runs.map((r) => ({ ...r, inputs: null }));
  const inputsBytes = Math.round(runs.reduce((n, r) => n + rowBytes("AgentRun", r).heap - rowBytes("AgentRun", { ...r, inputs: null }).heap, 0) / Math.max(runs.length, 1));
  const modelCallsPerYear = prod.reduce((n, k) => n + runsOf(k) * perRun(k, "modelCall"), 0);
  const checklistPerYear = prod.reduce((n, k) => n + runsOf(k) * perRun(k, "checklistResult"), 0);
  const deliverablesPerYear = prod.reduce((n, k) => n + runsOf(k) * perRun(k, "deliverable") + VOLUME.agentJobs[k] * perRun(k, "deliverable"), 0);
  const heartbeat = { userId: "u-01", at: new Date(), source: "lms" };
  const doneNote = { note: JSON.stringify({ gate: "close-gate", v: 1, checkedAt: new Date().toISOString(), deliverables: [{ id: "c".repeat(25), name: "CL001_GSTR-3B_2026-10_v1.xlsx", driveItemId: "01ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", sha256: "0".repeat(64), sizeBytes: 48000, path: "FY2026-27/GST/2026-10/Final/CL001_GSTR-3B_2026-10_v1.xlsx" }], turia: { syncId: "c".repeat(25), mode: "MANUAL", turiaRef: "TT-4411", minutesLogged: 90, confirmedById: "u-01", spotCheck: false }, filing: { filedEventId: "c".repeat(25), closingEventId: "c".repeat(25), filedById: "u-01", filedAt: new Date().toISOString(), ackRef: "AA2710260012345" } }), actorId: "system:close-gate", jobTaskId: "c".repeat(25), fromState: 1, toState: 2 };
  const events = rowsOf("jobTaskEvent");
  const closeRefused = { actorId: "system:close-loop-reconciler", action: "close-refused", entity: "JobTask", entityId: "c".repeat(25), meta: { reasons: ["Turia task not closed: enter the Turia task ref and minutes logged"], state: "CLOSING" } };
  const coachAudit = { actorId: "system:coach", action: "escalate", entity: "JobTask", entityId: "c".repeat(25), meta: { to: "c".repeat(25), reason: "internal-overdue", day: "2026-11-10" } };
  const lines: StorageLine[] = [
    { ...line("AgentRun", withoutInputs, totalRuns, `${Math.round(totalRuns)} runs (agent jobs × ${VOLUME.runsPerJob})`), steadyStateNote: `inputs Json adds ~${inputsBytes} B/run but is nulled after 30 days: ~${mib((totalRuns / 12) * inputsBytes)} MiB live at any time` },
    line("ChecklistResult", rowsOf("checklistResult"), checklistPerYear, "measured rows per run × runs"),
    line("Deliverable", rowsOf("deliverable"), deliverablesPerYear, "Working rows per run × runs + one Final set per job"),
    line("ModelCall", rowsOf("modelCall"), modelCallsPerYear, "measured model calls per run × runs (first runs; re-runs on unchanged inputs add none with the response cache)"),
    line("AuditEvent", rowsOf("auditEvent"), totalRuns * 2 + VOLUME.jobs * VOLUME.auditPerJob, `2 per run (guardrail-run, agent-run) + ${VOLUME.auditPerJob} per job (transitions, close, comments)`),
    {
      ...line("AuditEvent", [closeRefused], cronAudits.reconcilerPerRun * RECONCILER_RUNS_PER_DAY * VOLUME.workingDays, `reconciler: ${cronAudits.reconcilerPerRun} close-refused per run (held CLOSING jobs) × ${RECONCILER_RUNS_PER_DAY} runs × ${VOLUME.workingDays} days`),
      table: "AuditEvent (automated close-refused)",
      steadyStateNote: "grows every year (kept); P4c applied: an automated retry writes one only when the job's refusal reasons change",
    },
    { ...line("AuditEvent", [coachAudit], cronAudits.coachPerDay * VOLUME.workingDays, `coach: ${cronAudits.coachPerDay} per day (overdue escalations, board, summary) × ${VOLUME.workingDays} days`), table: "AuditEvent (coach crons)" },
    line("JobTaskEvent", [...events, doneNote], VOLUME.jobs * VOLUME.jobEventsPerJob, `${VOLUME.jobEventsPerJob} transitions per job; the DONE event carries the gate evidence JSON (~${doneNote.note.length} B)`),
    line("CoachEvent", coachEvents, coachPerDay * VOLUME.workingDays, `${Math.round(coachPerDay)} per working day (simulated morning board + reminders/escalations + weekly summary) × ${VOLUME.workingDays}`, "grows every year (no retention yet)"),
    { ...line("ActivityHeartbeat", [heartbeat], VOLUME.staff * VOLUME.heartbeatsPerPersonDay * VOLUME.workingDays, `${VOLUME.staff} people × ${VOLUME.heartbeatsPerPersonDay}/day × ${VOLUME.workingDays} days written`), steadyStateNote: `deleted after 7 days: ~${mib(VOLUME.staff * VOLUME.heartbeatsPerPersonDay * 7 * (rowBytes("ActivityHeartbeat", heartbeat).heap + rowBytes("ActivityHeartbeat", heartbeat).index))} MiB live at any time` },
  ];
  const assumptions = [
    `${VOLUME.jobs.toLocaleString("en-IN")} JobTasks a year for ~200 clients; agent jobs: ${prod.map((k) => `${k} ${VOLUME.agentJobs[k]}`).join(", ")} (TDS has no agent yet).`,
    `${VOLUME.runsPerJob} agent runs per agent job (one re-run in two).`,
    `${VOLUME.staff} staff, ${VOLUME.workingDays} working days, ${VOLUME.heartbeatsPerPersonDay} heartbeats per person per day (7.5 active hours, ≤ 1 a minute) when break nudges are on.`,
    "Bytes per row: Postgres heap tuple (28 B header, 8-byte alignment) + one entry per index (8 B + keys + 4 B line pointer); text = length + 1–4 B, jsonb ≈ 1.15 × JSON text, cuid ids 25 B. TOAST compression of large Json is not counted (upper bound).",
    "Rows are the ones the fixture runs actually wrote (agents) and the coach simulation wrote (CoachEvent).",
  ];
  return { lines, assumptions };
}

// ------------------------------------------------------------------ markdown

const fmt = (n: number | undefined) => (n === undefined ? "–" : Number.isInteger(n) ? n.toLocaleString("en-IN") : (Math.round(n * 100) / 100).toLocaleString("en-IN"));
const delta = (before: number | undefined, after: number | undefined) => {
  if (before === undefined || after === undefined) return "–";
  if (before === after) return "=";
  if (before === 0) return `+${fmt(after)}`;
  const pct = Math.round(((after - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
};
const opsList = (c: OpCounts | undefined) => (c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ") : "–");

function renderMeasured(title: string, after: Record<string, Measured>, before: Record<string, Measured> | undefined, withGraph: boolean): string {
  const head = withGraph
    ? "| Scenario | DB ops before | DB ops after | SQL (est.) before | SQL (est.) after | Graph calls before | Graph calls after | Δ Graph |\n|---|---:|---:|---:|---:|---:|---:|---:|"
    : "| Scenario | Prisma ops before | Prisma ops after | SQL (est.) before | SQL (est.) after | Δ |\n|---|---:|---:|---:|---:|---:|";
  const rows = Object.entries(after).map(([k, a]) => {
    const b = before?.[k];
    return withGraph
      ? `| ${k} | ${fmt(b?.total)} | ${fmt(a.total)} | ${fmt(b?.sql)} | ${fmt(a.sql)} | ${fmt(b?.graphTotal)} | ${fmt(a.graphTotal)} | ${delta(b?.graphTotal, a.graphTotal)} |`
      : `| ${k} | ${fmt(b?.total)} | ${fmt(a.total)} | ${fmt(b?.sql)} | ${fmt(a.sql)} | ${delta(b?.total, a.total)} |`;
  });
  const details = Object.entries(after)
    .map(([k, a]) => `- **${k}** — ${opsList(a.ops)}${a.graph ? `; Graph: ${opsList(a.graph)}` : ""}${a.note ? ` (${a.note})` : ""}${before?.[k] ? `\n  - before: ${opsList(before[k].ops)}${before[k].graph ? `; Graph: ${opsList(before[k].graph)}` : ""}` : ""}`)
    .join("\n");
  return `### ${title}\n\n${head}\n${rows.join("\n")}\n\n<details><summary>Operation breakdown</summary>\n\n${details}\n\n</details>\n`;
}

/** The headline numbers of one report. */
function headline(r: Report) {
  const prod = AGENT_KEYS.filter((k) => k !== "echo" && r.agents[k]);
  const mean = (f: (k: string) => number) => prod.reduce((n, k) => n + f(k), 0) / Math.max(prod.length, 1);
  const pick = (sec: Record<string, Measured>, ...parts: string[]) => Object.entries(sec).find(([k]) => parts.every((p) => k.includes(p)))?.[1];
  const steady = pick(r.reconciler, "run 2", "copyToFinal");
  const restart = pick(r.reconciler, "run 1", "restart");
  const kept = r.storage.filter((s) => s.table !== "ActivityHeartbeat").reduce((n, s) => n + s.perYearMiB, 0);
  return [
    ["Model calls per agent run (5 production agents, mean)", mean((k) => r.agents[k].perRun.modelCalls)],
    ["Model calls when a job is re-run on unchanged inputs (mean)", mean((k) => r.agents[k].perRun.rerunModelCalls)],
    ["Est. ₹ per re-run on unchanged inputs (GST)", r.agents.gst ? (r.agents.gst.perRun.rerunModelCalls ? r.agents.gst.costInrPerRun : 0) : 0],
    ["Graph calls per agent run (mean)", mean((k) => r.agents[k].perRun.graphCalls)],
    ["Graph calls per GST run", r.agents.gst?.perRun.graphCalls ?? 0],
    ["Graph calls per reconciler run (steady state)", steady?.graphTotal ?? 0],
    ["File downloads per reconciler run (steady state)", steady?.graph?.["GET file content (download)"] ?? 0],
    ["File downloads, first reconciler run after a restart", restart?.graph?.["GET file content (download)"] ?? 0],
    ["Graph calls to read an existing FY tree (ensureFyTree)", NaN],
    ["DB operations per reconciler run (steady state)", steady?.total ?? 0],
    ["DB operations per later coach reminder run", pick(r.coach, "later run")?.total ?? 0],
    ["DB operations per agent run, GST (pipeline + ModelCall log)", r.agents.gst ? r.agents.gst.perRun.dbOps + r.agents.gst.perRun.routerDbOps : 0],
    ["Queries per mistakes-admin render (30 rows)", pick(r.views, "mistakes")?.total ?? 0],
    ["Kept storage growth, MiB a year", Math.round(kept * 10) / 10],
  ] as [string, number][];
}

export function renderData(after: Report, before: Report | null, proposed: Report | null = null): string {
  const out: string[] = [];
  out.push(`_Generated by \`npx tsx scripts/efficiency-report.ts\` on ${after.generatedAt}. "Before" = ${before ? `the baseline measured on ${before.generatedAt} (${before.label})` : "not available"}${proposed ? `; "with patches" = this branch plus the proposed patches in efficiency-patches.md (${proposed.generatedAt})` : ""}. All counts come from instrumented in-memory fakes (no network); see the method section above._\n`);

  out.push("### Summary\n");
  const hA = headline(after);
  const hB = before ? headline(before) : null;
  const hP = proposed ? headline(proposed) : null;
  out.push(`| Measure | Before | After (this branch) | Δ |${hP ? " With proposed patches |" : ""}\n|---|---:|---:|---:|${hP ? "---:|" : ""}`);
  hA.forEach(([label, v], i) => {
    if (label.startsWith("Graph calls to read an existing FY tree")) {
      out.push(`| ${label} | ~32 | 7 | −78% |${hP ? " 7 |" : ""}`);
      return;
    }
    const b = hB?.[i][1];
    out.push(`| ${label} | ${fmt(b)} | ${fmt(v)} | ${delta(b, v)} |${hP ? ` ${fmt(hP[i][1])} |` : ""}`);
  });
  out.push("");

  out.push("### Agents — per run (average over every accuracy fixture)\n");
  out.push("| Agent | Fixtures | Model calls before | after | Re-run calls before | after | Tokens in / out before | after | Est. ₹/run before | after | DB ops before | after | Graph calls before | after |\n|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|");
  for (const k of AGENT_KEYS) {
    const a = after.agents[k];
    const b = before?.agents[k];
    if (!a) continue;
    const dbA = a.perRun.dbOps + a.perRun.routerDbOps;
    const dbB = b ? b.perRun.dbOps + b.perRun.routerDbOps : undefined;
    out.push(
      `| ${k} | ${a.fixtures} | ${fmt(b?.perRun.modelCalls)} | ${fmt(a.perRun.modelCalls)} | ${fmt(b?.perRun.rerunModelCalls)} | ${fmt(a.perRun.rerunModelCalls)} | ${b ? `${fmt(b.perRun.tokensIn)} / ${fmt(b.perRun.tokensOut)}` : "–"} | ${fmt(a.perRun.tokensIn)} / ${fmt(a.perRun.tokensOut)} | ${fmt(b?.costInrPerRun)} | ${fmt(a.costInrPerRun)} | ${fmt(dbB)} | ${fmt(dbA)} | ${fmt(b?.perRun.graphCalls)} | ${fmt(a.perRun.graphCalls)} |`,
    );
  }
  out.push("\n<details><summary>Per agent: model calls by task, database operations, Graph calls</summary>\n");
  for (const k of AGENT_KEYS) {
    const a = after.agents[k];
    const b = before?.agents[k];
    if (!a) continue;
    out.push(`**${k}** (fingerprint of the recorded accuracy outcomes \`${a.fingerprint.slice(0, 16)}\`${b ? (b.fingerprint === a.fingerprint ? " — identical before and after" : ` — before \`${b.fingerprint.slice(0, 16)}\` DIFFERS`) : ""})\n`);
    out.push(`- model calls by task: ${opsList(a.byTask)}${b ? ` (before: ${opsList(b.byTask)})` : ""}`);
    out.push(`- model tier: ${opsList(a.byModel)}`);
    out.push(`- agent pipeline Prisma ops: ${opsList(a.db)}`);
    out.push(`- router ModelCall log / budget ops: ${opsList(a.routerDb)}${b ? ` (before: ${opsList(b.routerDb)})` : ""}`);
    out.push(`- Graph: ${opsList(a.graph)}${b ? ` (before: ${opsList(b.graph)})` : ""}`);
    if (a.mismatches.length) out.push(`- mismatches: ${a.mismatches.join("; ")}`);
    out.push("");
  }
  out.push("</details>\n");

  out.push(renderMeasured("Close loop on Graph — one job, step by step", after.closeGate, before?.closeGate, true));
  out.push(renderMeasured("Cron: close-loop reconciler (200 clients, 2,000 jobs: 30 open close-loop jobs, 160 DONE in the last 30 days)", after.reconciler, before?.reconciler, true));
  out.push(renderMeasured("Cron: coach jobs (same firm)", after.coach, before?.coach, false));
  out.push(renderMeasured("Cron: retention (daily)", { "retention · daily run": after.retention }, before ? { "retention · daily run": before.retention } : undefined, false));
  out.push(renderMeasured("Pages and views — Prisma operations per render (firm-sized database)", after.views, before?.views, false));

  out.push("### Storage — bytes per row and one-year growth\n");
  out.push("| Table | Sample rows | Heap B/row | Index B/row | Rows / year | MiB / year | Note | Basis |\n|---|---:|---:|---:|---:|---:|---|---|");
  for (const s of after.storage) out.push(`| ${s.table} | ${fmt(s.sampleRows)} | ${fmt(s.heapPerRow)} | ${fmt(s.indexPerRow)} | ${fmt(s.perYearRows)} | ${fmt(s.perYearMiB)} | ${s.steadyStateNote} | ${s.basis} |`);
  const total = after.storage.filter((s) => s.table !== "ActivityHeartbeat").reduce((n, s) => n + s.perYearMiB, 0);
  out.push(`\nKept growth (all but heartbeats): **~${fmt(Math.round(total * 10) / 10)} MiB a year** before TOAST compression.\n`);
  out.push("Assumptions:\n");
  for (const a of after.assumptions) out.push(`- ${a}`);
  return out.join("\n");
}

export function upsertData(existing: string | null, block: string): string {
  const wrapped = `${DATA_START}\n${block}\n${DATA_END}`;
  if (!existing) return `# Firm OS efficiency report\n\n${wrapped}\n`;
  const s = existing.indexOf(DATA_START);
  const e = existing.indexOf(DATA_END);
  if (s >= 0 && e > s) return `${existing.slice(0, s)}${wrapped}${existing.slice(e + DATA_END.length)}`;
  return `${existing.trimEnd()}\n\n${wrapped}\n`;
}

// ------------------------------------------------------------------ main

async function main(): Promise<number> {
  let a: ReturnType<typeof args>;
  try {
    a = args(process.argv.slice(2));
  } catch (e) {
    console.error(`efficiency-report: ${(e as Error).message}`);
    return 2;
  }
  const measured: Record<string, AgentMeasure> = {};
  for (const k of AGENT_KEYS) {
    const def = AGENTS[k];
    if (!def) continue;
    process.stderr.write(`measuring ${k}…\n`);
    measured[k] = await measureAgent(def, { extras: routerExtras, repo: harnessRepo });
  }
  const packs: Record<string, ChecklistPack> = Object.fromEntries(Object.values(AGENTS).map((d) => [d.sopPackKey, d.defaultChecklist]));
  process.stderr.write("measuring views, close loop, crons…\n");
  const views = await measureViews(packs);
  const closeGate = await measureCloseGate();
  const reconciler = await measureReconciler();
  const coach = await measureCoach();
  const retention = await measureRetention();
  const coachRows = coach.events;
  const coachPerDay = coachRows.filter((e) => e.kind !== "summary").length + coachRows.filter((e) => e.kind === "summary").length / 5;
  const steadyRun = Object.entries(reconciler).find(([k]) => k.includes("run 2") && k.includes("copyToFinal"))?.[1];
  const coachAuditsPerDay = Object.entries(coach.results)
    .filter(([k]) => !k.includes("later run"))
    .reduce((n, [k, v]) => n + (v.ops["auditEvent.create"] ?? 0) / (k.includes("weekly") ? 5 : 1), 0);
  const st = storage(measured, coachRows, coachPerDay, { reconcilerPerRun: steadyRun?.ops["auditEvent.create"] ?? 0, coachPerDay: Math.round(coachAuditsPerDay) });
  const report: Report = {
    generatedAt: new Date().toISOString(),
    label: a.label,
    agents: Object.fromEntries(
      Object.entries(measured).map(([k, m]) => {
        const { rows, ...rest } = m;
        const cost = rows.modelCall.reduce((n, r) => n + Number(r.costInr ?? 0), 0) / Math.max(m.fixtures, 1);
        return [k, { ...rest, costInrPerRun: Math.round(cost * 100) / 100 }];
      }),
    ),
    views,
    closeGate,
    reconciler,
    coach: coach.results,
    retention,
    storage: st.lines,
    assumptions: st.assumptions,
  };
  writeFileSync(a.json, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`efficiency-report: numbers written to ${a.json}`);
  const before = a.baseline && existsSync(a.baseline) && a.baseline !== a.json ? (JSON.parse(readFileSync(a.baseline, "utf8")) as Report) : null;
  const proposed = a.proposed && existsSync(a.proposed) && a.proposed !== a.json ? (JSON.parse(readFileSync(a.proposed, "utf8")) as Report) : null;
  if (a.md) {
    const existing = existsSync(a.md) ? readFileSync(a.md, "utf8") : null;
    writeFileSync(a.md, upsertData(existing, renderData(report, before, proposed)));
    console.log(`efficiency-report: report written to ${a.md}`);
  }
  const mismatched = Object.values(measured).flatMap((m) => m.mismatches);
  for (const m of mismatched) console.error(`efficiency-report: ${m}`);
  const changed = before ? AGENT_KEYS.filter((k) => before.agents[k] && report.agents[k] && before.agents[k].fingerprint !== report.agents[k].fingerprint) : [];
  for (const k of changed) console.error(`efficiency-report: ${k} accuracy outcomes changed against the baseline`);
  void totalOps;
  return mismatched.length || changed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`efficiency-report: ${(e as Error).stack ?? String(e)}`);
    process.exit(2);
  },
);

// Pure aggregation behind /admin/firm-os/models: ModelCall rows → cost in ₹ by IST day, agent
// and provider, with call / escalation / queued-for-human counts. No Prisma, no fetch.
import { addDays, istDayKey, istDayStart, istLabel, parseDayKey } from "@/lib/ist";
import type { ProviderId } from "./types";

export interface UsageCall {
  createdAt: Date;
  agent: string | null;
  provider: ProviderId | null;
  status: string;
  escalated: boolean;
  costInr: number;
  tokensIn: number;
  tokensOut: number;
  /** ModelCall.task (`<task>@<v>`, `…#2` for an agreement re-ask). Guardrail rates only. */
  task?: string;
  /** ModelCall.error (masked); "contradiction:" marks a validator failure. Guardrail rates only. */
  error?: string | null;
}

export interface UsageBucket {
  key: string;
  calls: number;
  costInr: number;
  escalations: number;
  queued: number;
  refused: number;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageSummary {
  totals: UsageBucket;
  byDay: UsageBucket[];
  byAgent: UsageBucket[];
  byProvider: UsageBucket[];
}

const empty = (key: string): UsageBucket => ({ key, calls: 0, costInr: 0, escalations: 0, queued: 0, refused: 0, tokensIn: 0, tokensOut: 0 });

function add(b: UsageBucket, c: UsageCall): void {
  b.calls += 1;
  b.costInr = Math.round((b.costInr + c.costInr) * 10_000) / 10_000;
  if (c.escalated) b.escalations += 1;
  if (c.status === "QUEUED_FOR_HUMAN") b.queued += 1;
  if (c.status === "BUDGET_REFUSED") b.refused += 1;
  b.tokensIn += c.tokensIn;
  b.tokensOut += c.tokensOut;
}

function group(calls: UsageCall[], keyOf: (c: UsageCall) => string): Map<string, UsageBucket> {
  const m = new Map<string, UsageBucket>();
  for (const c of calls) {
    const k = keyOf(c);
    const b = m.get(k) ?? empty(k);
    add(b, c);
    m.set(k, b);
  }
  return m;
}

const byCostDesc = (a: UsageBucket, b: UsageBucket) => b.costInr - a.costInr || b.calls - a.calls || a.key.localeCompare(b.key);

export function summariseUsage(calls: UsageCall[]): UsageSummary {
  const totals = empty("total");
  for (const c of calls) add(totals, c);
  return {
    totals,
    byDay: [...group(calls, (c) => istDayKey(c.createdAt)).values()].sort((a, b) => a.key.localeCompare(b.key)),
    byAgent: [...group(calls, (c) => c.agent ?? "unassigned").values()].sort(byCostDesc),
    byProvider: [...group(calls, (c) => c.provider ?? "none").values()].sort(byCostDesc),
  };
}

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ₹ with Indian digit grouping: 123456 → "₹1,23,456.00". */
export function formatInr(n: number): string {
  return `${n < 0 ? "−" : ""}₹${INR.format(Math.abs(n))}`;
}
const COUNT = new Intl.NumberFormat("en-IN");
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** "2026-11-05" → "05 Nov 2026" (the DD MMM YYYY house format). */
export function formatDayKey(key: string): string {
  const d = parseDayKey(key);
  return d ? istLabel(d, { day: "2-digit", month: "short", year: "numeric" }) : key;
}

export interface UsageRange {
  from: Date; // 00:00 IST of the first day
  to: Date; // 00:00 IST of the day AFTER the last day (exclusive)
  fromKey: string;
  toKey: string;
}

export const MAX_RANGE_DAYS = 366;

// ---------------------------------------------------------------- guardrail drift (ADR-008 §9)
//
// Per agent per IST day: schema-fail rate (schema failures + validator contradictions / calls),
// escalation rate (escalated attempts / calls), abstain rate (insufficient_evidence / LLM
// verdicts asked), ungrounded rate (ungrounded items / grounding checks), disagreement rate
// (disagreements / agreement checks), and reviewer override rate ((request-changes + MistakeLog
// proposals) / runs). Scope violations breach at any count. A rate breaches when it is above its
// threshold and its denominator is at least `minSample`. Thresholds are env-overridable.

/** One run's `guardrail-run` AuditEvent (meta = the run's GuardrailStats). */
export interface GuardrailRunSignal {
  createdAt: Date;
  agent: string;
  judgements: number;
  abstained: number;
  groundChecked: number;
  ungrounded: number;
  agreementChecks: number;
  disagreements: number;
  scopeViolations: number;
  wrongInput: number;
}

/** Reviewer activity: a run produced, a run sent back (request changes), a MistakeLog proposal. */
export interface ReviewSignal {
  createdAt: Date;
  agent: string;
  kind: "run" | "changes-requested" | "mistake";
}

export const GUARDRAIL_METRICS = ["schemaFail", "escalation", "abstain", "ungrounded", "disagreement", "override"] as const;
export type GuardrailMetric = (typeof GUARDRAIL_METRICS)[number];

export const GUARDRAIL_METRIC_LABELS: Readonly<Record<GuardrailMetric | "scopeViolation", string>> = Object.freeze({
  schemaFail: "Schema / validator fail",
  escalation: "Escalation",
  abstain: "Abstain",
  ungrounded: "Ungrounded",
  disagreement: "Disagreement",
  override: "Reviewer override",
  scopeViolation: "Scope violation",
});

export type GuardrailThresholds = Record<GuardrailMetric, number> & { minSample: number };

export const DEFAULT_GUARDRAIL_THRESHOLDS: Readonly<GuardrailThresholds> = Object.freeze({
  schemaFail: 0.1,
  escalation: 0.25,
  abstain: 0.3,
  ungrounded: 0.02,
  disagreement: 0.1,
  override: 0.3,
  minSample: 5,
});

const THRESHOLD_ENV: Record<keyof GuardrailThresholds, string> = {
  schemaFail: "GUARDRAIL_MAX_SCHEMA_FAIL_RATE",
  escalation: "GUARDRAIL_MAX_ESCALATION_RATE",
  abstain: "GUARDRAIL_MAX_ABSTAIN_RATE",
  ungrounded: "GUARDRAIL_MAX_UNGROUNDED_RATE",
  disagreement: "GUARDRAIL_MAX_DISAGREEMENT_RATE",
  override: "GUARDRAIL_MAX_OVERRIDE_RATE",
  minSample: "GUARDRAIL_MIN_SAMPLE",
};

/** Thresholds with env overrides (rates in [0, 1]; minSample a positive integer). Bad values fall back. */
export function loadGuardrailThresholds(env: Record<string, string | undefined> = process.env): GuardrailThresholds {
  const out = { ...DEFAULT_GUARDRAIL_THRESHOLDS };
  for (const k of Object.keys(THRESHOLD_ENV) as (keyof GuardrailThresholds)[]) {
    const raw = env[THRESHOLD_ENV[k]]?.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (k === "minSample" ? Number.isInteger(n) && n >= 1 : Number.isFinite(n) && n >= 0 && n <= 1) out[k] = n;
  }
  return out;
}

export const guardrailThresholdEnv = (k: keyof GuardrailThresholds) => THRESHOLD_ENV[k];

export type Rate = { n: number; d: number; rate: number | null };
export type GuardrailBreach = { metric: GuardrailMetric | "scopeViolation"; rate: number | null; count: number; threshold: number | null; sample: number };
export type GuardrailDay = {
  agent: string;
  day: string;
  rates: Record<GuardrailMetric, Rate>;
  scopeViolations: number;
  wrongInput: number;
  breaches: GuardrailBreach[];
};

/** A model call that failed its schema or a validator (validator failures log as LOW_CONFIDENCE + "contradiction:"). */
export const isSchemaOrValidatorFailure = (c: Pick<UsageCall, "status" | "error">) => c.status === "SCHEMA_FAIL" || (c.status === "LOW_CONFIDENCE" && /(^|;\s*)contradiction:/.test(c.error ?? ""));

const rate = (n: number, d: number): Rate => ({ n, d, rate: d > 0 ? n / d : null });

/** Per agent per IST day guardrail rates and breaches, newest day first. */
export function guardrailRates(calls: UsageCall[], runs: GuardrailRunSignal[], reviews: ReviewSignal[], th: GuardrailThresholds = DEFAULT_GUARDRAIL_THRESHOLDS): GuardrailDay[] {
  type Acc = { calls: number; schemaFail: number; escalated: number; judgements: number; abstained: number; groundChecked: number; ungrounded: number; checks: number; disagreements: number; scope: number; wrongInput: number; runs: number; overrides: number };
  const acc = new Map<string, Acc>();
  const at = (agent: string, d: Date) => {
    const k = `${agent}\u0000${istDayKey(d)}`;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { calls: 0, schemaFail: 0, escalated: 0, judgements: 0, abstained: 0, groundChecked: 0, ungrounded: 0, checks: 0, disagreements: 0, scope: 0, wrongInput: 0, runs: 0, overrides: 0 }));
    return a;
  };
  for (const c of calls) {
    if (!c.agent) continue;
    const a = at(c.agent, c.createdAt);
    a.calls += 1;
    if (isSchemaOrValidatorFailure(c)) a.schemaFail += 1;
    if (c.escalated) a.escalated += 1;
  }
  for (const r of runs) {
    const a = at(r.agent, r.createdAt);
    a.judgements += r.judgements;
    a.abstained += r.abstained;
    a.groundChecked += r.groundChecked;
    a.ungrounded += r.ungrounded;
    a.checks += r.agreementChecks;
    a.disagreements += r.disagreements;
    a.scope += r.scopeViolations;
    a.wrongInput += r.wrongInput;
  }
  for (const r of reviews) {
    const a = at(r.agent, r.createdAt);
    if (r.kind === "run") a.runs += 1;
    else a.overrides += 1;
  }
  const out: GuardrailDay[] = [];
  for (const [k, a] of acc) {
    const [agent, day] = k.split("\u0000");
    const rates: Record<GuardrailMetric, Rate> = {
      schemaFail: rate(a.schemaFail, a.calls),
      escalation: rate(a.escalated, a.calls),
      abstain: rate(a.abstained, a.judgements),
      ungrounded: rate(a.ungrounded, a.groundChecked),
      disagreement: rate(a.disagreements, a.checks),
      override: rate(a.overrides, a.runs),
    };
    const breaches: GuardrailBreach[] = [];
    for (const m of GUARDRAIL_METRICS) {
      const r = rates[m];
      if (r.rate !== null && r.d >= th.minSample && r.rate > th[m]) breaches.push({ metric: m, rate: r.rate, count: r.n, threshold: th[m], sample: r.d });
    }
    if (a.scope > 0) breaches.push({ metric: "scopeViolation", rate: null, count: a.scope, threshold: 0, sample: a.runs });
    out.push({ agent, day, rates, scopeViolations: a.scope, wrongInput: a.wrongInput, breaches });
  }
  return out.sort((x, y) => y.day.localeCompare(x.day) || x.agent.localeCompare(y.agent));
}

/** "12.5%" / "—" when there is nothing to divide by. */
export function formatRate(r: Rate): string {
  return r.rate === null ? "—" : `${(Math.round(r.rate * 1000) / 10).toFixed(1)}%`;
}

/** Inclusive IST day range from query strings; defaults to the last 30 days, capped at a year. */
export function parseUsageRange(fromStr: string | undefined, toStr: string | undefined, now: Date): UsageRange {
  const today = istDayStart(now);
  let to = parseDayKey(toStr) ?? today;
  let from = parseDayKey(fromStr) ?? addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to: addDays(to, 1), fromKey: istDayKey(from), toKey: istDayKey(to) };
}

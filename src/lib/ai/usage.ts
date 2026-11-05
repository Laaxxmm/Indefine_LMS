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

/** Inclusive IST day range from query strings; defaults to the last 30 days, capped at a year. */
export function parseUsageRange(fromStr: string | undefined, toStr: string | undefined, now: Date): UsageRange {
  const today = istDayStart(now);
  let to = parseDayKey(toStr) ?? today;
  let from = parseDayKey(fromStr) ?? addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to: addDays(to, 1), fromKey: istDayKey(from), toKey: istDayKey(to) };
}

// Turia task -> Firm OS job rules (admin-editable, TuriaTaskRule). The first active rule, by
// position, whose words appear in the task wins; it names the service (the agent that prepares the
// job), the job title, the frequency (which period to read) and the statutory calendar rule.
// A task no rule matches still becomes a job, with no agent (`agentless`), prepared by hand.
//
// Pattern syntax, kept simple so a person can edit it: alternatives separated by "|"; inside an
// alternative, words joined by "+" must all appear. Matching is on whole words, ignoring case and
// punctuation, so "gstr 3b" matches "GSTR-3B Oct 2026" and "itr" does not match "arbitration".
// Pure: no Prisma.
import type { FirmService } from "@prisma/client";
import type { Frequency } from "./period";

export interface RuleRow {
  id: string;
  position: number;
  label: string;
  department: string | null;
  namePattern: string;
  service: FirmService;
  title: string;
  frequency: Frequency;
  useAgent: boolean;
  calendarRuleId: string | null;
  active: boolean;
}

export type SeedRule = Omit<RuleRow, "active">;

/** Services that have an agent today (src/lib/agents/registry.ts): GST, ROC, Tax, Books, Audit. */
export const AGENT_SERVICES: readonly FirmService[] = ["GST", "ROC", "IncomeTax", "Books", "Audit"];

/**
 * The rules a new installation starts with (saved on the first run; edit or switch off on
 * /admin/firm-os/turia-sync). Titles and calendar rules follow the onboarding planner's JOB_CATALOG,
 * so a Turia task and an onboarded job for the same return meet on the same job.
 */
export const SEED_RULES: readonly SeedRule[] = [
  { id: "seed-gstr-3b-qrmp", position: 10, label: "GSTR-3B under QRMP", department: null, namePattern: "gstr 3b+qrmp|gstr3b+qrmp|gstr 3b+quarterly|gstr3b+quarterly", service: "GST", title: "GSTR-3B (QRMP)", frequency: "QUARTERLY", useAgent: true, calendarRuleId: "gstr-3b" },
  { id: "seed-gstr-1-qrmp", position: 20, label: "GSTR-1 under QRMP", department: null, namePattern: "gstr 1+qrmp|gstr1+qrmp|gstr 1+quarterly|gstr1+quarterly", service: "GST", title: "GSTR-1 (QRMP)", frequency: "QUARTERLY", useAgent: true, calendarRuleId: "gstr-1" },
  { id: "seed-gstr-3b", position: 30, label: "GSTR-3B monthly", department: null, namePattern: "gstr 3b|gstr3b", service: "GST", title: "GSTR-3B", frequency: "MONTHLY", useAgent: true, calendarRuleId: "gstr-3b" },
  { id: "seed-gstr-1", position: 40, label: "GSTR-1 monthly", department: null, namePattern: "gstr 1|gstr1", service: "GST", title: "GSTR-1", frequency: "MONTHLY", useAgent: true, calendarRuleId: "gstr-1" },
  { id: "seed-gstr-9", position: 50, label: "GSTR-9 annual return", department: null, namePattern: "gstr 9|gstr9|gstr 9c|gstr9c", service: "GST", title: "GSTR-9", frequency: "ANNUAL", useAgent: true, calendarRuleId: "gstr-9" },
  { id: "seed-tds-24q", position: 60, label: "TDS return 24Q (salary)", department: null, namePattern: "24q", service: "TDS", title: "TDS 24Q", frequency: "QUARTERLY", useAgent: false, calendarRuleId: "tds-24q" },
  { id: "seed-tds-26q", position: 70, label: "TDS return 26Q", department: null, namePattern: "26q|tds return", service: "TDS", title: "TDS 26Q", frequency: "QUARTERLY", useAgent: false, calendarRuleId: "tds-26q" },
  { id: "seed-advance-tax", position: 80, label: "Advance tax", department: null, namePattern: "advance tax", service: "IncomeTax", title: "Advance tax", frequency: "QUARTERLY", useAgent: true, calendarRuleId: "advance-tax" },
  { id: "seed-itr", position: 90, label: "Income tax return", department: null, namePattern: "itr|income tax return", service: "IncomeTax", title: "ITR", frequency: "ANNUAL", useAgent: true, calendarRuleId: "itr" },
  { id: "seed-aoc-4", position: 100, label: "AOC-4", department: null, namePattern: "aoc 4|aoc4", service: "ROC", title: "AOC-4", frequency: "ANNUAL", useAgent: true, calendarRuleId: "aoc-4" },
  { id: "seed-mgt-7", position: 110, label: "MGT-7", department: null, namePattern: "mgt 7|mgt7|mgt 7a|mgt7a", service: "ROC", title: "MGT-7", frequency: "ANNUAL", useAgent: true, calendarRuleId: "mgt-7" },
  { id: "seed-adt-1", position: 120, label: "ADT-1", department: null, namePattern: "adt 1|adt1", service: "ROC", title: "ADT-1", frequency: "ANNUAL", useAgent: true, calendarRuleId: "adt-1" },
  { id: "seed-dir-3-kyc", position: 130, label: "DIR-3 KYC", department: null, namePattern: "dir 3|dir3", service: "ROC", title: "DIR-3 KYC", frequency: "ANNUAL", useAgent: true, calendarRuleId: "dir-3-kyc" },
  { id: "seed-llp-form-11", position: 140, label: "LLP Form 11", department: null, namePattern: "form 11|llp 11", service: "ROC", title: "LLP Form 11", frequency: "ANNUAL", useAgent: true, calendarRuleId: "llp-form-11" },
  { id: "seed-llp-form-8", position: 150, label: "LLP Form 8", department: null, namePattern: "form 8|llp 8", service: "ROC", title: "LLP Form 8", frequency: "ANNUAL", useAgent: true, calendarRuleId: "llp-form-8" },
  { id: "seed-roc-annual", position: 160, label: "ROC annual filing", department: "roc|secretarial|company law|mca", namePattern: "annual filing|annual return|annual compliance", service: "ROC", title: "ROC annual filing", frequency: "ANNUAL", useAgent: true, calendarRuleId: "roc-annual" },
  { id: "seed-books", position: 170, label: "Books close (monthly)", department: null, namePattern: "bookkeeping|book keeping|books close|books of accounts|accounting", service: "Books", title: "Books close", frequency: "MONTHLY", useAgent: true, calendarRuleId: "books-close" },
  { id: "seed-audit", position: 180, label: "Audit", department: null, namePattern: "statutory audit|audit", service: "Audit", title: "Audit", frequency: "ANNUAL", useAgent: true, calendarRuleId: "audit" },
];

/** Lower case, punctuation as spaces, single spaces: the form both sides are compared in. */
export function words(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pattern -> alternatives -> words that must all appear. Empty pieces are dropped. */
export function parsePattern(pattern: string | null | undefined): string[][] {
  return (pattern ?? "")
    .split("|")
    .map((alt) => alt.split("+").map(words).filter(Boolean))
    .filter((alt) => alt.length > 0);
}

/** Does the text contain any alternative of the pattern, each of its parts as whole words? */
export function matchesPattern(text: string, pattern: string): boolean {
  const hay = ` ${words(text)} `;
  return parsePattern(pattern).some((alt) => alt.every((w) => hay.includes(` ${w} `)));
}

/** The first active rule (by position) that matches the task, or null. */
export function matchRule(task: { taskName: string; department: string | null }, rules: readonly RuleRow[]): RuleRow | null {
  const ordered = [...rules].filter((r) => r.active).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  for (const r of ordered) {
    if (r.department?.trim() && !matchesPattern(task.department ?? "", r.department)) continue;
    if (matchesPattern(task.taskName, r.namePattern)) return r;
  }
  return null;
}

const GUESSES: readonly [string, FirmService][] = [
  ["gst|gstr", "GST"],
  ["tds|tcs", "TDS"],
  ["roc|mca|secretarial|company law", "ROC"],
  ["income tax|itr|tax", "IncomeTax"],
  ["audit|assurance", "Audit"],
  ["account|accounts|accounting|books|bookkeeping", "Books"],
];

/**
 * For a task no rule maps: the service it most likely belongs to, from its department, then its
 * name. Only a label for the job (it has no agent either way); "Engagement" when nothing fits.
 */
export function guessService(task: { taskName: string; department: string | null }): FirmService {
  for (const text of [task.department ?? "", task.taskName]) {
    for (const [pattern, service] of GUESSES) if (matchesPattern(text, pattern)) return service;
  }
  return "Engagement";
}

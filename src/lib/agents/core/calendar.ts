// Statutory calendar engine (Phase 3 task 6). Due-date RULES are data (CalendarPackSchema, stored in
// SopPack.calendar; defaults in calendar-defaults.ts); this engine is generic and knows no form.
//
//   statutory due = anchor (end of the period, or the AGM date) + offset, per rule / variant
//   internal due  = statutory âˆ’ bufferDays (SopPack.bufferDays, default 3), then moved back to the
//                   previous working day while it falls on a weekend or a holiday (hook)
//
// The statutory date itself is never moved: law, not the firm's calendar, decides it; the result
// says when it falls on a non-working day. Day math is on IST calendar days via src/lib/ist.ts.
// Pure: no Prisma, no fetch, no clock.
import { z } from "zod";
import { addDays, istDayKey, istWeekday, parseDayKey } from "@/lib/ist";

// ------------------------------------------------------------------ schema

export const PERIOD_KINDS = ["monthly", "quarterly", "half-yearly", "annual"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
const PERIOD_LABELS = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "Annual"] as const;
const SERVICES = ["GST", "ROC", "IncomeTax", "TDS", "Books", "Audit", "Engagement"] as const;

const DueSchema = z.discriminatedUnion("anchor", [
  z
    .object({
      /** Last month of the period + addMonths; `day` is clamped to that month's length, or "last". */
      anchor: z.literal("period-end"),
      addMonths: z.number().int().min(0).max(24),
      day: z.union([z.number().int().min(1).max(31), z.literal("last")]),
    })
    .strict(),
  z
    .object({
      /** `days` from the AGM. countAgmDay: the AGM day is day 1 (AGM 30 Sep + 30 days â†’ 29 Oct). */
      anchor: z.literal("agm"),
      days: z.number().int().min(1).max(366),
      countAgmDay: z.boolean(),
    })
    .strict(),
]);
export type DueSpec = z.infer<typeof DueSchema>;

const WhenSchema = z
  .object({
    qrmp: z.boolean().optional(),
    periodKind: z.enum(PERIOD_KINDS).optional(),
    /** Monthly periods only: 1-3 = first/second/third month of the FY quarter. */
    monthOfQuarter: z.array(z.number().int().min(1).max(3)).min(1).optional(),
    stateGroup: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    period: z.array(z.enum(PERIOD_LABELS)).min(1).optional(),
  })
  .strict();

const VariantSchema = z
  .object({
    id: z.string().min(1),
    when: WhenSchema,
    due: DueSchema.optional(),
    /** Set when nothing is due in this case; the text says why. */
    notApplicable: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => !!v.due !== !!v.notApplicable, "a variant has exactly one of due / notApplicable");

export const CalendarRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    form: z.string().min(1),
    title: z.string().min(1),
    service: z.enum(SERVICES),
    periodKinds: z.array(z.enum(PERIOD_KINDS)).min(1),
    due: DueSchema,
    /** Per-period replacement of `due` (e.g. TDS Q4 is due two months after March, not one). */
    periodOverrides: z.record(z.enum(PERIOD_LABELS), DueSchema).optional(),
    /** First match wins; checked before periodOverrides and `due`. */
    variants: z.array(VariantSchema).optional(),
    /** Allowed `category` values (e.g. ITR audit / non-audit); the first is the default. */
    categories: z.array(z.string().min(1)).min(1).optional(),
    /** Where the date comes from and what to re-check. Shown to staff. */
    source: z.string().min(1),
  })
  .strict();
export type CalendarRule = z.infer<typeof CalendarRuleSchema>;

export const CalendarPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    bufferDays: z.number().int().min(0).max(30).default(3),
    /** GST state code ("29") lists, referenced by variant `when.stateGroup`. */
    stateGroups: z.record(z.array(z.string().regex(/^\d{2}$/))).default({}),
    rules: z.array(CalendarRuleSchema),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const ids = new Set<string>();
    pack.rules.forEach((r, i) => {
      if (ids.has(r.id)) issue(["rules", i, "id"], `duplicate rule id ${r.id}`);
      ids.add(r.id);
      r.variants?.forEach((v, j) => {
        if (v.when.stateGroup && !pack.stateGroups[v.when.stateGroup]) issue(["rules", i, "variants", j], `unknown state group ${v.when.stateGroup}`);
        if (v.when.category && !r.categories?.includes(v.when.category)) issue(["rules", i, "variants", j], `category ${v.when.category} not in rule categories`);
      });
    });
    const owner = new Map<string, string>();
    for (const [group, codes] of Object.entries(pack.stateGroups)) {
      for (const c of codes) {
        if (owner.has(c)) issue(["stateGroups", group], `state ${c} is in both ${owner.get(c)} and ${group}`);
        owner.set(c, group);
      }
    }
  });
export type CalendarPack = z.infer<typeof CalendarPackSchema>;

export function parseCalendarPack(json: unknown): { ok: true; pack: CalendarPack } | { ok: false; errors: string[] } {
  const r = CalendarPackSchema.safeParse(json);
  return r.success ? { ok: true, pack: r.data } : { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

// ------------------------------------------------------------------ periods

export type ParsedPeriod = {
  label: string;
  kind: PeriodKind;
  /** Calendar year and month (1-12) of the period's last month. */
  endYear: number;
  endMonth: number;
  monthOfQuarter: 1 | 2 | 3 | null;
};

/** "2026-27" â†’ 2026, or null. */
export function parseFy(fy: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return null;
  const start = Number(m[1]);
  return (start + 1) % 100 === Number(m[2]) ? start : null;
}

/** "2026-10" | "Q1".."Q4" | "H1" | "H2" | "Annual", within the FY (Aprilâ€“March). */
export function parsePeriod(fy: string, period: string): ParsedPeriod | null {
  const start = parseFy(fy);
  if (start === null) return null;
  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthly) {
    const y = Number(monthly[1]);
    const m = Number(monthly[2]);
    if (m < 1 || m > 12) return null;
    const inFy = (y === start && m >= 4) || (y === start + 1 && m <= 3);
    if (!inFy) return null;
    return { label: period, kind: "monthly", endYear: y, endMonth: m, monthOfQuarter: (((m - 4 + 12) % 3) + 1) as 1 | 2 | 3 };
  }
  const fixed: Record<string, [PeriodKind, number, number]> = {
    Q1: ["quarterly", start, 6],
    Q2: ["quarterly", start, 9],
    Q3: ["quarterly", start, 12],
    Q4: ["quarterly", start + 1, 3],
    H1: ["half-yearly", start, 9],
    H2: ["half-yearly", start + 1, 3],
    Annual: ["annual", start + 1, 3],
  };
  const f = fixed[period];
  return f ? { label: period, kind: f[0], endYear: f[1], endMonth: f[2], monthOfQuarter: null } : null;
}

/** Every period label of a kind in the FY, in order. */
export function periodsFor(kind: PeriodKind, fy: string): string[] {
  const start = parseFy(fy);
  if (start === null) throw new Error(`invalid FY ${fy}`);
  if (kind === "quarterly") return ["Q1", "Q2", "Q3", "Q4"];
  if (kind === "half-yearly") return ["H1", "H2"];
  if (kind === "annual") return ["Annual"];
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${i < 9 ? start : start + 1}-${String(m).padStart(2, "0")}`;
  });
}

// ------------------------------------------------------------------ day math (IST calendar days)

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Shift a "YYYY-MM-DD" key by n calendar days. */
export function shiftDayKey(key: string, n: number): string {
  const d = parseDayKey(key);
  if (!d) throw new Error(`invalid day key ${key}`);
  return istDayKey(addDays(d, n));
}

function periodEndDue(p: ParsedPeriod, due: Extract<DueSpec, { anchor: "period-end" }>): string {
  const idx = p.endYear * 12 + (p.endMonth - 1) + due.addMonths;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = daysInMonth(y, m);
  return keyOf(y, m, due.day === "last" ? last : Math.min(due.day, last));
}

export type WorkingDayOptions = {
  /** Holiday hook: true when the IST day "YYYY-MM-DD" is a firm/bank holiday. */
  isHoliday?: (dayKey: string) => boolean;
  /** Weekday numbers treated as non-working (0 = Sunday â€¦ 6 = Saturday). Default Saturday + Sunday. */
  weekendDays?: readonly number[];
};

export function holidaysFrom(list: readonly string[]): (dayKey: string) => boolean {
  const set = new Set(list);
  return (k) => set.has(k);
}

export function isWorkingDay(key: string, opts: WorkingDayOptions = {}): boolean {
  const d = parseDayKey(key);
  if (!d) throw new Error(`invalid day key ${key}`);
  const weekend = opts.weekendDays ?? [0, 6];
  return !weekend.includes(istWeekday(d)) && !opts.isHoliday?.(key);
}

/** `key` if it is a working day, else the nearest earlier one. */
export function onOrBeforeWorkingDay(key: string, opts: WorkingDayOptions = {}): string {
  let k = key;
  for (let i = 0; i < 366; i++) {
    if (isWorkingDay(k, opts)) return k;
    k = shiftDayKey(k, -1);
  }
  throw new Error(`no working day in the year before ${key}`);
}

// ------------------------------------------------------------------ engine

export type DueContext = {
  fy: string;
  period: string;
  /** AGM date ("YYYY-MM-DD" or a Date, read as its IST day) for AGM-relative rules. */
  agmDate?: string | Date | null;
  /** GST state code of the registration ("29" = Karnataka). */
  state?: string | null;
  qrmp?: boolean;
  /** Rule category, e.g. ITR "audit"; defaults to the rule's first category. */
  category?: string | null;
};

export type DueOptions = WorkingDayOptions & {
  /** Days before the statutory date; default 3 (SopPack.bufferDays). */
  bufferDays?: number;
  stateGroups?: Readonly<Record<string, readonly string[]>>;
};

export type DueErrorCode =
  | "INVALID_FY"
  | "INVALID_PERIOD"
  | "PERIOD_KIND_NOT_SUPPORTED"
  | "AGM_DATE_REQUIRED"
  | "INVALID_AGM_DATE"
  | "STATE_REQUIRED"
  | "UNKNOWN_STATE"
  | "UNKNOWN_CATEGORY"
  | "NOT_APPLICABLE"
  | "UNKNOWN_RULE"
  | "INVALID_BUFFER";

export type DueDates = {
  ok: true;
  ruleId: string;
  form: string;
  fy: string;
  period: string;
  variantId: string | null;
  statutoryDue: string;
  statutoryDueAt: Date;
  statutoryOnNonWorkingDay: boolean;
  internalDue: string;
  internalDueAt: Date;
  bufferDays: number;
  /** Extra days the internal due moved back past weekends/holidays. */
  rolledBackDays: number;
  basis: string;
};
export type DueResult = DueDates | { ok: false; ruleId: string; code: DueErrorCode; message: string };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

function describeDue(due: DueSpec, p: ParsedPeriod): string {
  if (due.anchor === "agm") return `${due.days} days from the AGM${due.countAgmDay ? " (AGM day counted as day 1)" : ""}`;
  const day = due.day === "last" ? "last day" : ordinal(due.day);
  const when = due.addMonths === 0 ? "of the period's last month" : `of the ${due.addMonths === 1 ? "month" : `${ordinal(due.addMonths)} month`} after the period`;
  return `${day} ${when} (period ends ${MONTH[p.endMonth - 1]} ${p.endYear})`;
}

function toDayKey(v: string | Date): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : istDayKey(v);
  return parseDayKey(v) && istDayKey(parseDayKey(v) as Date) === v ? v : null;
}

/** Statutory and internal due dates for one rule and period. */
export function dueDatesFor(rule: CalendarRule, ctx: DueContext, opts: DueOptions = {}): DueResult {
  const fail = (code: DueErrorCode, message: string): DueResult => ({ ok: false, ruleId: rule.id, code, message });
  const bufferDays = opts.bufferDays ?? 3;
  if (!Number.isInteger(bufferDays) || bufferDays < 0 || bufferDays > 60) return fail("INVALID_BUFFER", `bufferDays must be 0-60, got ${bufferDays}`);
  if (parseFy(ctx.fy) === null) return fail("INVALID_FY", `FY must look like 2026-27, got "${ctx.fy}"`);
  const p = parsePeriod(ctx.fy, ctx.period);
  if (!p) return fail("INVALID_PERIOD", `"${ctx.period}" is not a period of FY ${ctx.fy}`);
  if (!rule.periodKinds.includes(p.kind)) return fail("PERIOD_KIND_NOT_SUPPORTED", `${rule.form} is not filed ${p.kind} (allowed: ${rule.periodKinds.join(", ")})`);

  const category = ctx.category ?? rule.categories?.[0] ?? null;
  if (ctx.category && !rule.categories?.includes(ctx.category)) return fail("UNKNOWN_CATEGORY", `${rule.form} has no category "${ctx.category}"`);

  let chosen: { id: string | null; due: DueSpec } | null = null;
  for (const v of rule.variants ?? []) {
    const w = v.when;
    if (w.qrmp !== undefined && w.qrmp !== (ctx.qrmp ?? false)) continue;
    if (w.periodKind && w.periodKind !== p.kind) continue;
    if (w.monthOfQuarter && (p.monthOfQuarter === null || !w.monthOfQuarter.includes(p.monthOfQuarter))) continue;
    if (w.category && w.category !== category) continue;
    if (w.period && !(w.period as string[]).includes(p.label)) continue;
    if (w.stateGroup) {
      if (!ctx.state) return fail("STATE_REQUIRED", `${rule.form}: the due date depends on the state of registration; give the GST state code`);
      const groups = opts.stateGroups ?? {};
      const group = Object.keys(groups).find((g) => groups[g].includes(ctx.state as string));
      if (!group) return fail("UNKNOWN_STATE", `${rule.form}: state code "${ctx.state}" is in no state group`);
      if (group !== w.stateGroup) continue;
    }
    if (v.notApplicable) return fail("NOT_APPLICABLE", `${rule.form} ${p.label}: ${v.notApplicable}`);
    chosen = { id: v.id, due: v.due as DueSpec };
    break;
  }
  if (!chosen) chosen = { id: null, due: rule.periodOverrides?.[p.label as (typeof PERIOD_LABELS)[number]] ?? rule.due };

  let statutoryDue: string;
  if (chosen.due.anchor === "agm") {
    if (!ctx.agmDate) return fail("AGM_DATE_REQUIRED", `${rule.form} is counted from the AGM; give the AGM date`);
    const agm = toDayKey(ctx.agmDate);
    if (!agm) return fail("INVALID_AGM_DATE", `AGM date "${String(ctx.agmDate)}" is not a valid date`);
    statutoryDue = shiftDayKey(agm, chosen.due.countAgmDay ? chosen.due.days - 1 : chosen.due.days);
  } else {
    statutoryDue = periodEndDue(p, chosen.due);
  }

  const target = shiftDayKey(statutoryDue, -bufferDays);
  const internalDue = onOrBeforeWorkingDay(target, opts);
  const rolledBackDays = Math.round(((parseDayKey(target) as Date).getTime() - (parseDayKey(internalDue) as Date).getTime()) / 86_400_000);

  return {
    ok: true,
    ruleId: rule.id,
    form: rule.form,
    fy: ctx.fy,
    period: p.label,
    variantId: chosen.id,
    statutoryDue,
    statutoryDueAt: parseDayKey(statutoryDue) as Date,
    statutoryOnNonWorkingDay: !isWorkingDay(statutoryDue, opts),
    internalDue,
    internalDueAt: parseDayKey(internalDue) as Date,
    bufferDays,
    rolledBackDays,
    basis: describeDue(chosen.due, p),
  };
}

/** dueDatesFor with the pack's state groups and buffer (caller options win). */
export function packDueDates(pack: CalendarPack, ruleId: string, ctx: DueContext, opts: DueOptions = {}): DueResult {
  const rule = pack.rules.find((r) => r.id === ruleId);
  if (!rule) return { ok: false, ruleId, code: "UNKNOWN_RULE", message: `no calendar rule "${ruleId}"` };
  return dueDatesFor(rule, ctx, { bufferDays: pack.bufferDays, stateGroups: pack.stateGroups, ...opts });
}

/** Every period of `periodKind` in the FY (for generating a year's JobTasks). */
export function dueDatesForFy(
  rule: CalendarRule,
  ctx: Omit<DueContext, "period"> & { periodKind: PeriodKind },
  opts: DueOptions = {},
): DueResult[] {
  return periodsFor(ctx.periodKind, ctx.fy).map((period) => dueDatesFor(rule, { ...ctx, period }, opts));
}

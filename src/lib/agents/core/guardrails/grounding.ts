// Grounding (ADR-008 §4). Every object in a model output that carries `{ quote, location }` must
// quote the documents the model was given (quoteInContext from the checklist engine: whitespace
// and letter case normalised, nothing else), and every groundedNumber() field must equal a number
// written in the quote of its enclosing object ("1,23,456.00" == 123456; ₹ / Rs / grouping
// tolerated; compared by magnitude, to the paisa). An ungrounded object is dropped together with
// the smallest array element that contains it; when there is no such element the whole output
// is ungrounded (`rootUngrounded`) and the caller must not use it. Pure.
import type { ZodTypeAny } from "zod";
import { quoteInContext } from "../checklist";
import { INSUFFICIENT_EVIDENCE, groundedNumberPaths } from "./schema";

export type GroundIssue = { path: string; reason: string };

export type GroundResult<T> = {
  /** The output with ungrounded array elements removed (the input is not modified). */
  output: T;
  /** Evidence objects and grounded numbers checked. */
  checked: number;
  /** Items dropped (an ungrounded root counts as one). */
  ungrounded: number;
  /** True when an ungrounded object is not inside any array: the output cannot be used. */
  rootUngrounded: boolean;
  issues: GroundIssue[];
};

export class GroundingError extends Error {
  readonly issues: GroundIssue[];
  constructor(task: string, issues: GroundIssue[]) {
    super(`Model output for ${task} is not grounded in the documents: ${issues.map((i) => `${i.path || "(root)"} ${i.reason}`).join("; ")}`.slice(0, 1500));
    this.name = "GroundingError";
    this.issues = issues;
  }
}

const GROUPED = /(?<![\d.])(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?(?!\d)/g;
const PLAIN = /\d+(?:\.\d+)?/g;
const toPaise = (n: number) => Math.round(Math.abs(n) * 100);

/** Magnitudes (in paise) of the numbers written in a text, Indian or international grouping. */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(GROUPED)) out.add(toPaise(Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`)));
  for (const m of text.matchAll(PLAIN)) out.add(toPaise(Number(m[0])));
  return out;
}

/** Does `value` (rupees as written, or paise when `paise`) equal a number in the quote? */
export function numberInQuote(value: number, quote: string, paise = false): boolean {
  if (!Number.isFinite(value)) return false;
  const want = paise ? Math.round(Math.abs(value)) : toPaise(value);
  return numbersIn(quote).has(want);
}

type Seg = string | number;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pathText = (p: Seg[]) => p.map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`)).join("");
const keyOf = (p: Seg[]) => JSON.stringify(p);

/**
 * Check `output` against `sourceText` (what the model was shown). `schema` marks groundedNumber()
 * fields; without it only quotes are checked.
 */
export function groundCheck<T>(output: T, sourceText: string, opts: { schema?: ZodTypeAny } = {}): GroundResult<T> {
  const grounded = new Map((opts.schema ? groundedNumberPaths(opts.schema) : []).map((g) => [g.path, g.paise]));
  const issues: GroundIssue[] = [];
  const targets = new Set<string>();
  let rootUngrounded = false;
  let checked = 0;

  /** chain: objects from the nearest array element (or root) down to the current one. */
  const flag = (path: Seg[], lastArray: number, reason: string) => {
    issues.push({ path: pathText(path), reason });
    if (lastArray < 0) rootUngrounded = true;
    else targets.add(keyOf(path.slice(0, lastArray + 1)));
  };

  const scan = (v: unknown, path: Seg[], pattern: string, lastArray: number, chain: Record<string, unknown>[]) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => scan(x, [...path, i], `${pattern}[]`, path.length, []));
      return;
    }
    if (typeof v === "number") {
      if (!grounded.has(pattern)) return;
      checked += 1;
      const holder = [...chain].reverse().find((o) => typeof o.quote === "string");
      if (!holder) flag(path, lastArray, "is a grounded number with no quote beside it");
      else if (!numberInQuote(v, holder.quote as string, grounded.get(pattern))) flag(path, lastArray, `${v} does not appear in its quote "${String(holder.quote).slice(0, 80)}"`);
      return;
    }
    if (!isObj(v)) return;
    const here = [...chain, v];
    if ("quote" in v && "location" in v) {
      const quote = typeof v.quote === "string" ? v.quote : "";
      const location = typeof v.location === "string" ? v.location : "";
      const abstained = here.some((o) => Object.values(o).includes(INSUFFICIENT_EVIDENCE));
      if (!(abstained && !quote.trim())) {
        checked += 1;
        if (!quote.trim() || !location.trim()) flag(path, lastArray, "has an empty quote or location");
        else if (!quoteInContext(quote, sourceText)) flag(path, lastArray, `quote "${quote.slice(0, 80)}" does not occur in the documents`);
      }
    }
    for (const [k, child] of Object.entries(v)) scan(child, [...path, k], pattern ? `${pattern}.${k}` : k, lastArray, here);
  };
  scan(output, [], "", -1, []);

  const rebuild = (v: unknown, path: Seg[]): unknown => {
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      v.forEach((x, i) => {
        if (!targets.has(keyOf([...path, i]))) out.push(rebuild(x, [...path, i]));
      });
      return out;
    }
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, rebuild(c, [...path, k])]));
    return v;
  };

  // Nested targets inside a dropped element are not counted twice.
  const outer = [...targets].filter((t) => ![...targets].some((o) => o !== t && t.startsWith(o.slice(0, -1) + ",")));
  return { output: rebuild(output, []) as T, checked, ungrounded: outer.length + (rootUngrounded ? 1 : 0), rootUngrounded, issues };
}

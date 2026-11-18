// Closed outputs (ADR-008 §2–4). Helpers agents build their model-task schemas from, and the
// static checks the accuracy harness and tests run over every declared task schema:
//
//   abstainable(z.enum([...]))  the enum plus "insufficient_evidence" — the model may always abstain
//   note()                      free text capped at NOTE_MAX (300) characters
//   evidence()                  { quote, location } — verbatim quote + where it is (grounded later)
//   groundedNumber()            a number that must appear in the quote of its enclosing object
//   unboundedStrings(schema)    paths of strings that are neither enums, evidence quote/location,
//                               nor capped at ≤ NOTE_MAX — must be empty for every task
//   schemaFingerprint(schema)   stable description of the shape incl. caps / enums (prompt lock)
//
// Pure: Zod schema walking only.
import { z, type ZodTypeAny } from "zod";

export const INSUFFICIENT_EVIDENCE = "insufficient_evidence" as const;
export type InsufficientEvidence = typeof INSUFFICIENT_EVIDENCE;
/** Longest free-text note a model output may carry. */
export const NOTE_MAX = 300;

/** The enum plus "insufficient_evidence": a closed classification that can always abstain. */
export function abstainable<const T extends readonly [string, ...string[]]>(e: z.ZodEnum<[...T]>): z.ZodEnum<[...T, InsufficientEvidence]> {
  const values = e.options as unknown as string[];
  if (values.includes(INSUFFICIENT_EVIDENCE)) return e as unknown as z.ZodEnum<[...T, InsufficientEvidence]>;
  return z.enum([...values, INSUFFICIENT_EVIDENCE] as unknown as [...T, InsufficientEvidence]);
}

/** Short free text (reason, question for the reviewer), capped at NOTE_MAX characters. */
export const note = (max: number = NOTE_MAX) => z.string().max(Math.min(max, NOTE_MAX));

/** Verbatim quote from the supplied documents and where it is (file and row / line / page). */
export const evidence = () => z.object({ quote: z.string().max(2000), location: z.string().max(300) });

// ------------------------------------------------------------------ grounded numbers

// The marker lives in the schema's _def, which Zod copies on every chained call (.int(), .min(), …).
const GROUNDED_KEY = "firmOsGroundedNumber";
type Grounded = { paise: boolean };
const groundedOf = (s: ZodTypeAny): Grounded | null => ((s._def as Record<string, unknown>)[GROUNDED_KEY] as Grounded | undefined) ?? null;

/**
 * A number the model copies from the documents. groundCheck requires it to equal a number written
 * in the `quote` of its enclosing object (Indian grouping, ₹ and Rs tolerated). `paise: true` when
 * the field holds paise and the quote is in rupees (compared at ×100).
 */
export function groundedNumber(opts: { paise?: boolean } = {}): z.ZodNumber {
  const base = z.number();
  return new z.ZodNumber({
    ...base._def,
    description: "Copy this number exactly as it is written in the quote; do not compute it.",
    [GROUNDED_KEY]: { paise: opts.paise === true },
  } as z.ZodNumberDef);
}

/** Is this schema node (or the one it wraps) a groundedNumber()? */
export function groundedNumberInfo(schema: ZodTypeAny): Grounded | null {
  let s: ZodTypeAny | undefined = schema;
  for (let i = 0; s && i < 10; i++) {
    const hit = groundedOf(s);
    if (hit) return hit;
    s = unwrapOnce(s);
  }
  return null;
}

// ------------------------------------------------------------------ walking

type Def = { typeName?: string; [k: string]: unknown };
const defOf = (s: ZodTypeAny) => s._def as Def;

/** One level of Optional / Nullable / Default / Effects / Branded / Catch / Readonly / Pipeline / Lazy. */
function unwrapOnce(s: ZodTypeAny): ZodTypeAny | undefined {
  const d = defOf(s);
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodReadonly":
      return d.innerType as ZodTypeAny;
    case "ZodEffects":
      return d.schema as ZodTypeAny;
    case "ZodBranded":
      return d.type as ZodTypeAny;
    case "ZodPipeline":
      return d.in as ZodTypeAny;
    case "ZodLazy":
      return (d.getter as () => ZodTypeAny)();
    default:
      return undefined;
  }
}

/** Visit every node with its path ("a.b[].c"); `parentKeys` are the sibling keys of an object field. */
type Visit = (node: ZodTypeAny, path: string, ctx: { key: string | null; siblings: string[] }) => void;

function walk(schema: ZodTypeAny, visit: Visit, path = "", ctx: { key: string | null; siblings: string[] } = { key: null, siblings: [] }, depth = 0): void {
  if (depth > 40) return;
  visit(schema, path, ctx);
  const d = defOf(schema);
  const at = (p: string) => (path ? `${path}${p.startsWith("[") ? "" : "."}${p}` : p.replace(/^\./, ""));
  const inner = unwrapOnce(schema);
  if (inner) return walk(inner, visit, path, ctx, depth + 1);
  switch (d.typeName) {
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      const keys = Object.keys(shape);
      for (const k of keys) walk(shape[k], visit, at(k), { key: k, siblings: keys }, depth + 1);
      return;
    }
    case "ZodArray":
      return walk(d.type as ZodTypeAny, visit, at("[]"), { key: null, siblings: [] }, depth + 1);
    case "ZodSet":
      return walk(d.valueType as ZodTypeAny, visit, at("[]"), { key: null, siblings: [] }, depth + 1);
    case "ZodTuple":
      (d.items as ZodTypeAny[]).forEach((it, i) => walk(it, visit, at(`[${i}]`), { key: null, siblings: [] }, depth + 1));
      return;
    case "ZodRecord":
    case "ZodMap":
      walk(d.keyType as ZodTypeAny, visit, at("{key}"), { key: null, siblings: [] }, depth + 1);
      return walk(d.valueType as ZodTypeAny, visit, at("{}"), { key: null, siblings: [] }, depth + 1);
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = d.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      for (const o of Array.isArray(options) ? options : [...options.values()]) walk(o, visit, path, ctx, depth + 1);
      return;
    }
    case "ZodIntersection":
      walk(d.left as ZodTypeAny, visit, path, ctx, depth + 1);
      return walk(d.right as ZodTypeAny, visit, path, ctx, depth + 1);
    default:
      return;
  }
}

type Check = { kind: string; value?: number; regex?: RegExp };
const stringCap = (s: ZodTypeAny): number | null => {
  const checks = (defOf(s).checks as Check[] | undefined) ?? [];
  const caps = checks.filter((c) => (c.kind === "max" || c.kind === "length") && typeof c.value === "number").map((c) => c.value as number);
  return caps.length ? Math.min(...caps) : null;
};

/** Evidence fields are exempt from the note cap: a `quote` or `location` key in an object that has both. */
const isEvidenceField = (ctx: { key: string | null; siblings: string[] }) =>
  (ctx.key === "quote" || ctx.key === "location") && ctx.siblings.includes("quote") && ctx.siblings.includes("location");

/**
 * Paths of free-form strings in a model-task schema: a string must be an enum / literal, an
 * evidence quote or location, or carry `.max(n)` / `.length(n)` with n ≤ NOTE_MAX. `any` /
 * `unknown` are free-form too. Empty list = closed output.
 */
export function unboundedStrings(schema: ZodTypeAny): string[] {
  const out = new Set<string>();
  walk(schema, (node, path, ctx) => {
    const t = defOf(node).typeName;
    const where = path || "(root)";
    if (t === "ZodString") {
      if (isEvidenceField(ctx)) return;
      const cap = stringCap(node);
      if (cap === null) out.add(`${where}: free text without a length cap (use an enum, evidence(), or note() ≤ ${NOTE_MAX})`);
      else if (cap > NOTE_MAX) out.add(`${where}: text capped at ${cap} > ${NOTE_MAX} characters`);
    } else if (t === "ZodAny" || t === "ZodUnknown") {
      out.add(`${where}: unconstrained value (${t === "ZodAny" ? "any" : "unknown"})`);
    }
  });
  return [...out];
}

/** Does the schema offer an "insufficient_evidence" outcome anywhere (an abstainable enum or literal)? */
export function hasAbstainOption(schema: ZodTypeAny): boolean {
  let found = false;
  walk(schema, (node) => {
    const d = defOf(node);
    if (d.typeName === "ZodEnum" && (d.values as string[]).includes(INSUFFICIENT_EVIDENCE)) found = true;
    if (d.typeName === "ZodLiteral" && d.value === INSUFFICIENT_EVIDENCE) found = true;
  });
  return found;
}

/** Paths ("rows[].amount") of groundedNumber() fields. */
export function groundedNumberPaths(schema: ZodTypeAny): { path: string; paise: boolean }[] {
  const out: { path: string; paise: boolean }[] = [];
  const seen = new Set<string>();
  walk(schema, (node, path) => {
    const g = groundedOf(node);
    if (g && !seen.has(path)) {
      seen.add(path);
      out.push({ path, paise: g.paise });
    }
  });
  return out;
}

/**
 * Stable description of a schema for the prompt lock: node types, object keys (sorted), enum
 * values, literal values, optional / nullable, string and number checks (caps, regex sources,
 * ints) and grounded markers. Any change to the output contract changes the fingerprint.
 */
export function schemaFingerprint(schema: ZodTypeAny, depth = 0, enumValues = true): unknown {
  if (depth > 40) return "…";
  const d = defOf(schema);
  const next = (s: unknown) => schemaFingerprint(s as ZodTypeAny, depth + 1, enumValues);
  const checks = () => ((d.checks as Check[] | undefined) ?? []).map((c) => [c.kind, c.value ?? null, c.regex ? c.regex.source : null]);
  const g = groundedOf(schema);
  switch (d.typeName) {
    case "ZodString":
      return ["string", checks()];
    case "ZodNumber":
      return ["number", checks(), g ? (g.paise ? "grounded-paise" : "grounded") : null];
    case "ZodBoolean":
    case "ZodNull":
    case "ZodDate":
    case "ZodBigInt":
    case "ZodAny":
    case "ZodUnknown":
      return [String(d.typeName).slice(3).toLowerCase()];
    case "ZodLiteral":
      return ["literal", d.value as string];
    case "ZodEnum":
      return enumValues ? ["enum", [...(d.values as string[])]] : ["enum", (d.values as string[]).includes(INSUFFICIENT_EVIDENCE) ? "abstainable" : "closed"];
    case "ZodNativeEnum":
      return ["native-enum", Object.values(d.values as Record<string, string | number>)];
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      return ["object", Object.keys(shape).sort().map((k) => [k, next(shape[k])]), String((d.unknownKeys as string) ?? "strip")];
    }
    case "ZodArray":
      return ["array", next(d.type), (d.minLength as { value: number } | null)?.value ?? null, (d.maxLength as { value: number } | null)?.value ?? null];
    case "ZodTuple":
      return ["tuple", (d.items as ZodTypeAny[]).map(next)];
    case "ZodRecord":
      return ["record", next(d.keyType), next(d.valueType)];
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = d.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      return ["union", (Array.isArray(options) ? options : [...options.values()]).map(next)];
    }
    case "ZodIntersection":
      return ["intersection", next(d.left), next(d.right)];
    case "ZodOptional":
      return ["optional", next(d.innerType)];
    case "ZodNullable":
      return ["nullable", next(d.innerType)];
    case "ZodDefault":
      return ["default", next(d.innerType)];
    case "ZodEffects":
      return ["effects", String(d.effect && (d.effect as { type?: string }).type), next(d.schema)];
    default: {
      const inner = unwrapOnce(schema);
      return inner ? next(inner) : [String(d.typeName ?? "unknown")];
    }
  }
}

/** schemaFingerprint with enum values left out (only whether each enum can abstain): per-call schemas vs their template. */
export const shapeFingerprint = (schema: ZodTypeAny): string => JSON.stringify(schemaFingerprint(schema, 0, false));

// ------------------------------------------------------------------ verdict schema for LLM rules

/**
 * Model answer for an LLM checklist rule of a scoped agent: closed status (may abstain), a capped
 * note, and verbatim evidence (required unless the model abstains). The checklist engine checks
 * the quote against the documents the model was shown; insufficient_evidence becomes `na` +
 * `insufficient-evidence` for the reviewer.
 */
export const ScopedVerdictSchema = z
  .object({
    status: abstainable(z.enum(["pass", "fail", "na"])),
    /** For insufficient_evidence: the question to put to the client / reviewer. */
    message: note().optional(),
    evidence: evidence().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status !== INSUFFICIENT_EVIDENCE && (!v.evidence || !v.evidence.quote.trim() || !v.evidence.location.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "evidence.quote and evidence.location are required unless status is insufficient_evidence" });
    }
  });
export type ScopedVerdict = z.infer<typeof ScopedVerdictSchema>;

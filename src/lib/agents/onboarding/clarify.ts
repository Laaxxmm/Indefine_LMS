// The clarifier: given a partial spec, ask ONLY for what is missing (or invalid), at most five
// questions per turn, always in the same priority order (spec.ts requiredFields). Pure.
// applyAnswers() turns the short form's values back into spec fields.
import type { EntityType } from "@prisma/client";
import { fyFor } from "@/lib/clients/core";
import type { Person } from "./people";
import {
  BOOKS_SOFTWARE, ENTITY_TYPES, FIELD_LABELS, FIRM_SERVICES, SERVICE_FREQUENCIES,
  normalizeFyInput, normalizePeriod, normalizePhone, normalizeServices, requiredFields, isMissing, serviceLineLabel,
  type Frequency, type PartialSpec, type ServiceLine, type SpecField,
} from "./spec";

export const MAX_QUESTIONS = 5;

export type QuestionKind = "text" | "email" | "tel" | "number" | "select" | "services" | "gstins" | "month";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  field: SpecField;
  label: string;
  kind: QuestionKind;
  options?: QuestionOption[];
  placeholder?: string;
  help?: string;
  defaultValue?: string | string[];
  /** Why the current value was rejected (validators), when re-asking. */
  error?: string;
}

export interface ClarifyContext {
  people?: Person[];
  /** Candidates from people.ts when a name matched several people. */
  candidates?: Partial<Record<"assigneeId" | "reviewerId", Person[]>>;
  /** Validator messages for fields that are present but wrong; these are re-asked. */
  invalid?: Partial<Record<SpecField, string>>;
  now?: Date;
}

/** Every service × frequency combination, as "GST:MONTHLY" option values. */
export const SERVICE_OPTIONS: QuestionOption[] = FIRM_SERVICES.flatMap((service) =>
  SERVICE_FREQUENCIES[service].map((frequency) => ({ value: `${service}:${frequency}`, label: serviceLineLabel({ service, frequency }) })),
);

function personQuestion(field: "assigneeId" | "reviewerId", spec: PartialSpec, ctx: ClarifyContext): Question {
  const nameField = field === "assigneeId" ? "assigneeName" : "reviewerName";
  const typed = spec[nameField];
  const candidates = ctx.candidates?.[field] ?? [];
  const pool = candidates.length > 1 ? candidates : ctx.people ?? [];
  let help: string | undefined;
  if (typed && candidates.length > 1) help = `"${typed}" matches ${candidates.length} people. Pick one.`;
  else if (typed && candidates.length === 0) help = `No active person named "${typed}". Pick from the list.`;
  return {
    field,
    label: FIELD_LABELS[field],
    kind: "select",
    options: pool.map((p) => ({ value: p.id, label: p.name })),
    ...(help ? { help } : {}),
  };
}

function question(field: SpecField, spec: PartialSpec, ctx: ClarifyContext): Question {
  const label = FIELD_LABELS[field];
  switch (field) {
    case "entityType":
      return { field, label, kind: "select", options: (Object.keys(ENTITY_TYPES) as EntityType[]).map((k) => ({ value: k, label: ENTITY_TYPES[k] })) };
    case "services":
      return { field, label, kind: "services", options: SERVICE_OPTIONS };
    case "clientCode":
      return { field, label, kind: "text", placeholder: "ACME01", help: "The Turia / firm client code: 3–10 characters, A–Z and 0–9." };
    case "fy":
      return { field, label, kind: "text", placeholder: "2026-27", defaultValue: fyFor(ctx.now ?? new Date()) };
    case "assigneeId":
    case "reviewerId":
      return personQuestion(field, spec, ctx);
    case "pan":
      return { field, label, kind: "text", placeholder: "AAAAA9999A" };
    case "gstins":
      return { field, label, kind: "gstins", placeholder: "29AAAAA9999A1Z5", help: "One per line if the client has more than one registration." };
    case "cin":
      return {
        field,
        label: spec.entityType === "LLP" ? "LLPIN" : "CIN",
        kind: "text",
        placeholder: spec.entityType === "LLP" ? "AAB-1234" : "U12345KA2020PTC123456",
      };
    case "firstPeriod":
      return { field, label, kind: "month", help: "The first month the firm handles. Quarterly work starts with the quarter that contains it." };
    case "contactEmail":
      return { field, label, kind: "email" };
    case "contactPhone":
      return { field, label, kind: "tel", placeholder: "10 digits" };
    case "turnoverInr":
      return { field, label, kind: "text", placeholder: "e.g. 2.5 Cr or 45,00,000", help: "An estimate is fine. Stored on the LMS client record." };
    case "billing":
      return { field, label, kind: "text", placeholder: "e.g. Retainer ₹15,000 per month" };
    case "dscHolder":
      return { field, label, kind: "text", placeholder: "Who holds the DSC, e.g. the director, or 'Firm (safe custody)'" };
    case "booksSoftware":
      return { field, label, kind: "select", options: BOOKS_SOFTWARE.map((b) => ({ value: b, label: b })) };
    default:
      return { field, label, kind: "text" };
  }
}

/** Missing or invalid required fields as questions, in priority order, at most MAX_QUESTIONS. */
export function clarify(spec: PartialSpec, ctx: ClarifyContext = {}): Question[] {
  const invalid = ctx.invalid ?? {};
  const out: Question[] = [];
  for (const field of requiredFields(spec)) {
    const error = invalid[field];
    if (!isMissing(spec, field) && !error) continue;
    out.push({ ...question(field, spec, ctx), ...(error ? { error } : {}) });
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------- answers → spec

export type Answers = Record<string, string | string[]>;

/** "2.5 Cr", "₹40 lakh", "45,00,000", "800k" → rupees; NaN when it is not an amount. */
export function parseInr(text: string): number {
  const s = text.toLowerCase().replace(/[₹,\s]/g, "").replace(/^rs\.?/, "");
  const m = /^(\d+(?:\.\d+)?)(crores?|cr|lakhs?|lacs?|l|k)?$/.exec(s);
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  if (unit.startsWith("cr")) return Math.round(n * 10_000_000);
  if (unit.startsWith("l")) return Math.round(n * 100_000);
  if (unit === "k") return Math.round(n * 1_000);
  return n;
}

const asString = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("\n") : v ?? "").trim();
const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : (v ?? "").split(/[\s,;]+/)).map((s) => s.trim()).filter(Boolean);

/** Merge the short form's values into the spec. Unknown fields are ignored; unparseable ones are reported. */
export function applyAnswers(spec: PartialSpec, answers: Answers): { spec: PartialSpec; errors: Partial<Record<SpecField, string>> } {
  const out: PartialSpec = { ...spec };
  const errors: Partial<Record<SpecField, string>> = {};
  for (const [key, raw] of Object.entries(answers)) {
    const field = key as SpecField;
    if (!(field in FIELD_LABELS)) continue;
    const text = asString(raw);
    if (field === "services") {
      const values = asList(raw);
      const lines: ServiceLine[] = [];
      for (const v of values) {
        const opt = SERVICE_OPTIONS.find((o) => o.value === v);
        if (!opt) {
          errors.services = `Unknown service "${v}"`;
          continue;
        }
        const [service, frequency] = v.split(":") as [ServiceLine["service"], Frequency];
        lines.push({ service, frequency });
      }
      if (lines.length) out.services = normalizeServices(lines);
      continue;
    }
    if (!text) continue;
    switch (field) {
      case "gstins":
        out.gstins = [...new Set(asList(raw).map((g) => g.toUpperCase()))];
        break;
      case "turnoverInr": {
        const n = parseInr(text);
        if (Number.isNaN(n)) errors.turnoverInr = "Enter an amount, e.g. 2.5 Cr or 45,00,000";
        else out.turnoverInr = n;
        break;
      }
      case "pan":
      case "clientCode":
      case "cin":
        out[field] = text.replace(/\s+/g, "").toUpperCase();
        break;
      case "fy":
        out.fy = normalizeFyInput(text);
        break;
      case "firstPeriod":
        out.firstPeriod = normalizePeriod(text, out.fy);
        break;
      case "contactPhone":
        out.contactPhone = normalizePhone(text);
        break;
      case "contactEmail":
        out.contactEmail = text.toLowerCase();
        break;
      case "entityType":
        if (text in ENTITY_TYPES) out.entityType = text as EntityType;
        else errors.entityType = "Pick an entity type from the list";
        break;
      case "booksSoftware":
        if ((BOOKS_SOFTWARE as readonly string[]).includes(text)) out.booksSoftware = text as PartialSpec["booksSoftware"];
        else errors.booksSoftware = "Pick Tally, Zoho or Other";
        break;
      case "growthGoal":
        break; // not asked by the clarifier; stays at its default
      default:
        (out as Record<string, unknown>)[field] = text;
    }
  }
  return { spec: out, errors };
}

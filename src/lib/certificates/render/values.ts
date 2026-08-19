import { z } from "zod";
import type { CertificateTemplate, FieldDef } from "../types";

// resolveValues: zod-validate a raw payload against the schema implied by `fields`
// (respecting requiredWhen, deriveFrom, validate:"udin", numeric coercion, computed
// table rows), then produce the deterministic render values. Throws a typed error
// listing every missing/invalid field — a half-filled certificate can never render.

export class CertificateValidationError extends Error {
  constructor(public readonly fieldErrors: { key: string; message: string }[]) {
    super(`Certificate payload invalid: ${fieldErrors.map((e) => `${e.key} (${e.message})`).join(", ")}`);
    this.name = "CertificateValidationError";
  }
}

export interface ResolvedTable {
  rowLabels: string[]; // empty when dynamic
  columns: { key: string; label: string }[];
  cells: string[][]; // [row][col], already formatted for output
  dynamic: boolean; // no leading row-label column; row count came from the payload
}

export interface ResolvedValues {
  inline: Record<string, string>; // field key -> inline string (text/date/year/number/fragment/bool text/udin)
  tables: Record<string, ResolvedTable>;
  blocks: Record<string, { enabled: boolean; inline: Record<string, string> }>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("date must be YYYY-MM-DD");
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  if (mi < 0 || mi > 11) throw new Error("invalid month");
  return `${Number(d)} ${MONTHS[mi]} ${y}`;
}

function fmtNumber(v: string, unit?: string): string {
  const t = v.trim();
  if (t === "-" || t === "" || /^nil$/i.test(t)) return "-";
  const n = Number(t.replace(/,/g, ""));
  if (Number.isNaN(n)) throw new Error("must be numeric");
  const s = n.toLocaleString("en-IN");
  return unit ? `${s} ${unit}` : s;
}

// An untouched optional input. Only strings can be "blank": a boolToggle's `false` and a
// number 0 are real answers, not absence.
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function isRequired(f: FieldDef, payload: Record<string, unknown>): boolean {
  if (f.requiredWhen) return payload[f.requiredWhen.field] === f.requiredWhen.equals && !!f.required;
  return !!f.required;
}

// Resolve one inline (non-table, non-block) field to its output string.
function resolveInline(f: FieldDef, raw: unknown, errors: { key: string; message: string }[]): string {
  const push = (message: string) => errors.push({ key: f.key, message });
  switch (f.type) {
    case "text":
    case "textarea": {
      const v = z.string().safeParse(raw);
      if (!v.success || v.data.trim() === "") return (push("required"), "");
      return v.data;
    }
    case "date": {
      const v = z.string().safeParse(raw);
      if (!v.success || v.data.trim() === "") return (push("required"), "");
      try {
        return formatDate(v.data);
      } catch (e) {
        return (push((e as Error).message), "");
      }
    }
    case "year": {
      const v = z.string().regex(/^\d{4}$/).safeParse(String(raw ?? ""));
      if (!v.success) return (push("4-digit year required"), "");
      return v.data;
    }
    case "number": {
      const v = z.string().safeParse(String(raw ?? ""));
      if (!v.success || v.data.trim() === "") return (push("required"), "");
      try {
        return fmtNumber(v.data, f.unit);
      } catch (e) {
        return (push((e as Error).message), "");
      }
    }
    case "udin": {
      // NEVER generated — shape-validated only (§0.5).
      const v = z.string().regex(/^[0-9A-Z]{18}$/).safeParse(String(raw ?? ""));
      if (!v.success) return (push("must match ^[0-9A-Z]{18}$ (paste from ICAI portal)"), "");
      return v.data;
    }
    case "enumToggle": {
      const opt = f.options?.find((o) => o.value === raw);
      if (!opt) return (push(`choose one of: ${f.options?.map((o) => o.value).join(", ")}`), "");
      return opt.fragment;
    }
    case "boolToggle": {
      if (typeof raw !== "boolean") return (push("choose yes/no"), "");
      return raw ? f.onText ?? "" : f.offText ?? "";
    }
    default:
      return (push(`unsupported inline type ${f.type}`), "");
  }
}

function resolveTable(f: FieldDef, raw: unknown, errors: { key: string; message: string }[]): ResolvedTable {
  const spec = f.table!;
  const dynamic = spec.dynamicRows === true;
  const nCols = spec.columns.length;
  const input = (raw as string[][] | undefined) ?? [];
  const nRows = dynamic ? input.length : spec.rowLabels.length;
  const computed = new Map<number, "sumAbove">();
  if (!dynamic) for (const c of spec.computedRows ?? []) computed.set(c.rowIndex, c.formula);

  const cells: string[][] = [];
  for (let r = 0; r < nRows; r++) {
    const row: string[] = [];
    for (let c = 0; c < nCols; c++) {
      const isNumeric = spec.columns[c].numeric !== false;
      if (!isNumeric) {
        row.push(String(input[r]?.[c] ?? "").trim());
      } else if (computed.has(r)) {
        // deterministic sum of the numeric cells above in this column
        let sum = 0;
        for (let rr = 0; rr < r; rr++) {
          const t = (input[rr]?.[c] ?? "").trim();
          if (t && t !== "-" && !/^nil$/i.test(t)) sum += Number(t.replace(/,/g, "")) || 0;
        }
        row.push(sum.toLocaleString("en-IN"));
      } else {
        try {
          row.push(fmtNumber(String(input[r]?.[c] ?? "-")));
        } catch {
          errors.push({ key: `${f.key}[${r}][${c}]`, message: "must be numeric" });
          row.push("");
        }
      }
    }
    cells.push(row);
  }
  return { rowLabels: dynamic ? [] : spec.rowLabels, columns: spec.columns, cells, dynamic };
}

export function resolveValues(template: CertificateTemplate, rawPayload: Record<string, unknown>): ResolvedValues {
  const payload = { ...rawPayload };
  const errors: { key: string; message: string }[] = [];

  // 1. derive fields keyed to another (e.g. I/we, my/our all follow signerType).
  for (const f of template.fields) {
    if (f.deriveFrom) payload[f.key] = payload[f.deriveFrom];
  }

  const inline: Record<string, string> = {};
  const tables: Record<string, ResolvedTable> = {};
  const blocks: Record<string, { enabled: boolean; inline: Record<string, string> }> = {};

  for (const f of template.fields) {
    if (f.type === "computed") continue; // resolver-derived (year-phrase below), never prompted
    if (f.type === "table") {
      tables[f.key] = resolveTable(f, payload[f.key], errors);
      continue;
    }
    if (f.type === "optionalBlock") {
      const enabled = f.enabledWhen ? payload[f.enabledWhen.field] === f.enabledWhen.equals : payload[f.key] === true;
      const sub: Record<string, string> = {};
      if (enabled) {
        for (const sf of f.subFields ?? []) {
          if (isRequired(sf, payload) || payload[sf.key] !== undefined) sub[sf.key] = resolveInline(sf, payload[sf.key], errors);
        }
      }
      blocks[f.key] = { enabled, inline: sub };
      continue;
    }
    // inline field: only enforce presence when required (respecting requiredWhen / derive).
    // The form seeds EVERY field with "" (never undefined), so an untouched optional field
    // must be read as absent — otherwise resolveInline flags it "required" and the user is
    // asked to fill a field the template says is optional.
    if (!f.deriveFrom && !isRequired(f, payload) && isBlank(payload[f.key])) {
      inline[f.key] = "";
    } else if (f.deriveFrom || isRequired(f, payload) || payload[f.key] !== undefined) {
      inline[f.key] = resolveInline(f, payload[f.key], errors);
    } else if (f.required) {
      errors.push({ key: f.key, message: "required" });
    }
  }

  // Computed FY-list phrase — up to five years (year1 required, year2–5 optional). Fills
  // the "March 31, Y1, March 31, Y2 and March 31, YN" recurrences. `tight` drops the space
  // after the FIRST comma (the source's para-9/enclosure phrasing "March 31,20X1").
  const ys = ["year1", "year2", "year3", "year4", "year5"].map((k) => String(payload[k] ?? "").trim()).filter((y) => /^\d{4}$/.test(y));
  if (ys.length) {
    const parts = ys.map((y) => `March 31, ${y}`);
    const phrase = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    inline.yearsPhrase = phrase;
    inline.yearsPhraseTight = phrase.replace("March 31, ", "March 31,");
  }

  if (errors.length) throw new CertificateValidationError(errors);
  return { inline, tables, blocks };
}

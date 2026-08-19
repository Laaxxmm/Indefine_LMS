// Domain model for the ICAI certificate template system (§3.1).
// A format is an ordered list of segments; a segment is either LOCKED legal text
// (verified verbatim against the source PDF) or a reference to a typed field.
// One field can fill many occurrences; either/or legal choices are explicit typed
// toggles, never free text. NO LLM ever touches this at issue time.

export type FieldType =
  | "text" // single line
  | "textarea" // multi-line (addresses)
  | "date" // rendered per a fixed format, e.g. "31 March 2025"
  | "year" // 4-digit financial-year-end year; fills every "20XX"
  | "number" // numeric; optional unit label
  | "enumToggle" // pick one of N options; each option maps to a text fragment
  | "boolToggle" // include/exclude a conditional clause (and/or swap wording)
  | "udin" // validated ^[0-9A-Z]{18}$, NEVER generated
  | "table" // fixed row labels + fixed columns, numeric cells
  | "computed" // value derived by the resolver (not prompted), e.g. the FY-list phrase
  | "optionalBlock"; // a whole paragraph the user may switch on, with its own sub-fields

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  repeatKey?: string; // same repeatKey across segments => one input fills all
  options?: { value: string; label: string; fragment: string }[]; // enumToggle
  onText?: string; // boolToggle wording when true (may be "")
  offText?: string; // boolToggle wording when false (may be "")
  unit?: string; // number
  table?: {
    rowLabels: string[]; // fixed row headers; ignored (use []) when dynamicRows is set
    columns: { key: string; label: string; numeric?: boolean }[]; // numeric defaults true; text columns (e.g. "Basis of valuation") pass through
    computedRows?: { rowIndex: number; formula: "sumAbove" }[]; // deterministic only; applies to numeric columns (ignored for dynamicRows)
    dynamicRows?: boolean; // row count comes from the payload; no leading row-label column (lists: shareholders, turnover, …)
  };
  subFields?: FieldDef[]; // optionalBlock
  subSegments?: Segment[]; // optionalBlock body (locked text + field refs), rendered only when on.
  //   ^ Extension beyond §3.1: an optionalBlock is "a whole paragraph"; it needs its own
  //     ordered segments so the block's fixed wording is rendered AND fidelity-checked.
  requiredWhen?: { field: string; equals: string | boolean }; // conditional requiredness
  enabledWhen?: { field: string; equals: string | boolean }; // optionalBlock: auto-on when another field equals X (else on via own boolean)
  deriveFrom?: string; // value copied from another field; NOT prompted in the UI.
  //   ^ Extension beyond §3.1, sanctioned by §4 ("derived toggles all keyed to signerType"):
  //     lets one user choice (e.g. Firm vs Individual) drive many grammatical recurrences
  //     (I/we, my/our, me/us, am/are) without asking the user once per occurrence.
  validate?: string; // named zod refinement (e.g. "udin")
}

export type Segment =
  | { kind: "text"; text: string } // LOCKED legal text — must exist verbatim in source PDF
  | { kind: "field"; key: string }; // renders the field's value/fragment inline

export interface CertificateTemplate {
  id: string; // "i-ufce", "ii-networth-visa", ...
  romanNo: string; // "i".."xii"
  title: string; // exact ICAI title
  version: string; // "2025.10.0" — bump on any change, never mutate a shipped one
  status: "draft" | "enabled"; // enabled only when verifier passes AND verifiedBy is set
  sourcePdf: string; // path to committed source PDF
  sourcePages: [number, number]; // physical PDF page range for the verifier
  hash: string; // sha256 of normalized concatenated locked text (see normalize.ts / §6)
  verifiedBy?: string; // human sign-off — REQUIRED before enabling in prod
  verifiedAt?: string; // ISO date
  fields: FieldDef[];
  segments: Segment[]; // header + body + signature block, in order
  tables?: string[]; // field keys of type "table", rendered where referenced
  boldFields?: string[]; // field keys whose value renders BOLD inline (entity/authority names, key dates)
  pageBreakBefore?: string[]; // line prefixes that must start a fresh page (annexures)
  headings?: string[]; // exact lines this template renders as bold section headings.
  //   ^ compose.classifyLine knows the ICAI headings shared by formats i–xii; a template
  //     with its own section names (the firm's audit report) declares them here rather
  //     than growing that shared set.
  notes?: string[]; // transcription judgment calls flagged for the human reviewer (§4)
}

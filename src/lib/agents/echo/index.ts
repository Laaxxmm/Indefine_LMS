// "Echo" — a dummy task agent that exercises the whole framework (Phase 4 QA gate). Input is a
// small register (register.csv: ref,party,date,amount). The register is parsed by deterministic
// code (echoInputSchema → parseEchoRegister); extract() only hands that parse on, compute() adds it
// up, and three deterministic rules (block / warn / info) read it. The model is used for one thing
// only: the related-party LLM rule, a genuine judgement over the party names. One XLSX deliverable
// is produced. Two parameterised checks (amount-over, party-listed) are registered but not in the
// default pack: approved MistakeLog rules use them (supervised loop tests). `probeMutation` adds
// ₹1 to the first amount so the accuracy harness can prove the figures follow the input.
// Hidden from the UI unless FIRM_OS_ECHO_AGENT is on (src/lib/agents/flags.ts).
//
// ADR-008 reference adoption: echo declares a full AgentScope — department Books, its one model
// task (`echo.check:echo.related-party@1`: abstainable verdict, high-stakes so it is read twice,
// a validator that the cited row exists), every rule id, and an input sniff that rejects a
// register.csv without the register header (naming the right agent when it is a GST register or a
// trial balance) before any model call.
import { z } from "zod";
import { createRuleRegistry, type ChecklistPack, type CheckOutcome } from "@/lib/agents/core/checklist";
import { formatInr } from "@/lib/agents/core/format";
import { CHECK_TASK_INSTRUCTIONS, type AgentScope, type InputSniffResult, type ModelTaskSpec, type SniffFile } from "@/lib/agents/core/guardrails/scope";
import { INSUFFICIENT_EVIDENCE, ScopedVerdictSchema, type ScopedVerdict } from "@/lib/agents/core/guardrails/schema";
import type { AgentDefinition, CheckInput, InputFile } from "@/lib/agents/core/runner";

export const ECHO_KEY = "echo";
export const ECHO_REGISTER_FILE = "register.csv";
export const ECHO_COLUMNS = ["ref", "party", "date", "amount"] as const;
/** Model task of the one LLM rule (the only model call echo makes): `<key>.check:<ruleId>`. */
export const ECHO_RELATED_PARTY_TASK = "echo.check:echo.related-party" as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const EchoRowSchema = z.object({
  ref: z.string().trim().min(1).max(60),
  party: z.string().trim().min(1).max(200),
  date: z.string().regex(DAY, "date must be YYYY-MM-DD"),
  amountPaise: z.number().int(),
});
export const EchoExtractSchema = z.object({ rows: z.array(EchoRowSchema).max(5000) });
export type EchoRow = z.infer<typeof EchoRowSchema>;
export type EchoExtract = z.infer<typeof EchoExtractSchema>;
/** The parsed register: rows come from register.csv by code, never from a model. */
export type EchoInput = { fileName: string; csv: string; rows: EchoRow[] };
export type EchoCheckInput = CheckInput<EchoInput, EchoExtract>;

const rowLoc = (i: number) => `register.csv row ${i + 2}`; // +1 header, +1 one-based

// ------------------------------------------------------------------ register parsing (code)

/** One CSV line → trimmed cells. Double-quoted cells may hold commas; "" inside quotes is a quote. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** "15,000.50" / "-2000" / "8999.9" → integer paise, by string arithmetic (no floating point). */
export function rupeesToPaise(text: string): number | null {
  const t = text.replace(/[\s,]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return null;
  return m[1] === "-" ? -paise : paise;
}

/** Integer paise → "15000.50" (the register's own format). */
export function paiseToRupees(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const isCalendarDay = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export type RegisterParse = { rows: EchoRow[]; errors: string[] };

/** Parse register.csv (header ref,party,date,amount). Every problem is reported with its row. */
export function parseEchoRegister(csv: string): RegisterParse {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  if (header.join(",") !== ECHO_COLUMNS.join(",")) {
    return { rows: [], errors: [`${ECHO_REGISTER_FILE}: header must be ${ECHO_COLUMNS.join(",")} (found "${lines[0] ?? ""}")`] };
  }
  const rows: EchoRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const at = rowLoc(i);
    const cells = splitCsvLine(line);
    if (cells.length !== ECHO_COLUMNS.length) {
      errors.push(`${at}: expected ${ECHO_COLUMNS.length} columns, found ${cells.length}`);
      return;
    }
    const [ref, party, date, amount] = cells;
    const amountPaise = rupeesToPaise(amount);
    const problems: string[] = [];
    if (!ref) problems.push("ref is blank");
    if (!party) problems.push("party is blank");
    if (!isCalendarDay(date)) problems.push(`date "${date}" is not a YYYY-MM-DD calendar date`);
    if (amountPaise === null) problems.push(`amount "${amount}" is not a rupee amount`);
    if (problems.length) {
      errors.push(`${at}: ${problems.join("; ")}`);
      return;
    }
    const row = EchoRowSchema.safeParse({ ref, party, date, amountPaise });
    if (row.success) rows.push(row.data);
    else errors.push(`${at}: ${row.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  if (!errors.length && !rows.length) errors.push(`${ECHO_REGISTER_FILE} has a header but no entries`);
  return { rows, errors };
}

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();
const findRegister = <T extends { name: string }>(files: T[]) => files.find((x) => x.name.toLowerCase() === ECHO_REGISTER_FILE);

export const echoInputSchema = z
  .array(InputFileZ)
  .transform((files, ctx): EchoInput => {
    const f = findRegister(files);
    const csv = f?.bytes.toString("utf8").trim() ?? "";
    if (!f) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "register.csv is missing from the client documents" });
    else if (!csv) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "register.csv is empty" });
    const parsed = csv ? parseEchoRegister(csv) : { rows: [], errors: [] };
    for (const message of parsed.errors) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return { fileName: f?.name ?? ECHO_REGISTER_FILE, csv, rows: parsed.rows };
  }) as unknown as z.ZodType<EchoInput, z.ZodTypeDef, InputFile[]>;

/**
 * Accuracy-harness probe: the same files with ₹1 added to the first entry's amount. Returns new
 * file objects; the originals are not modified. Files without a parsable first entry come back
 * unchanged (the harness then reports that the probe changed nothing).
 */
export function echoProbeMutation(files: InputFile[]): InputFile[] {
  const f = findRegister(files);
  if (!f) return files;
  const lines = f.bytes.toString("utf8").split(/\r?\n/);
  const i = lines.findIndex((l, n) => n > 0 && l.trim() !== "");
  if (i < 0) return files;
  const cells = splitCsvLine(lines[i]);
  const paise = cells.length === ECHO_COLUMNS.length ? rupeesToPaise(cells[3]) : null;
  if (paise === null) return files;
  cells[3] = paiseToRupees(paise + 100);
  const next = [...lines];
  next[i] = cells.map(csvCell).join(",");
  return files.map((x) => (x === f ? { ...x, bytes: Buffer.from(next.join("\n"), "utf8") } : x));
}

// ------------------------------------------------------------------ rules

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isSafeInteger(v) ? v : fallback);

/** Round-sum threshold defaults: ₹1,00,000 and above, in multiples of ₹10,000. */
export const ROUND_MIN_PAISE = 1_00_000_00;
export const ROUND_MULTIPLE_PAISE = 10_000_00;

export const echoRegistry = createRuleRegistry<EchoCheckInput>({
  "echo.duplicate-refs": ({ extracted }): CheckOutcome => {
    const seen = new Map<string, number>();
    for (const [i, r] of extracted.rows.entries()) {
      const key = r.ref.toUpperCase();
      const first = seen.get(key);
      if (first !== undefined) {
        return { status: "fail", message: `Reference ${r.ref} appears twice`, evidence: { quote: r.ref, location: `${rowLoc(first)} and ${rowLoc(i)}` } };
      }
      seen.set(key, i);
    }
    return { status: "pass" };
  },
  "echo.round-amounts": ({ extracted }, rule): CheckOutcome => {
    const min = num(rule.params?.minPaise, ROUND_MIN_PAISE);
    const multiple = num(rule.params?.multiplePaise, ROUND_MULTIPLE_PAISE);
    const hits = extracted.rows.map((r, i) => ({ r, i })).filter(({ r }) => Math.abs(r.amountPaise) >= min && r.amountPaise % multiple === 0);
    if (!hits.length) return { status: "pass" };
    const { r, i } = hits[0];
    return {
      status: "fail",
      message: `${hits.length} large round amount(s), e.g. ${r.ref} for ₹${formatInr(r.amountPaise / 100)}`,
      evidence: { quote: `${r.ref},${r.party},${r.date},${paiseToRupees(r.amountPaise)}`, location: rowLoc(i) },
    };
  },
  "echo.weekend-dates": ({ extracted }): CheckOutcome => {
    const hits = extracted.rows.map((r, i) => ({ r, i })).filter(({ r }) => [0, 6].includes(weekday(r.date)));
    if (!hits.length) return { status: "pass" };
    return { status: "fail", message: `${hits.length} entr${hits.length === 1 ? "y is" : "ies are"} dated on a weekend`, evidence: { quote: hits[0].r.date, location: rowLoc(hits[0].i) } };
  },
  // Parameterised checks for promoted mistake rules.
  "echo.amount-over": ({ extracted }, rule): CheckOutcome => {
    const limit = num(rule.params?.limitPaise, Number.MAX_SAFE_INTEGER);
    const i = extracted.rows.findIndex((r) => r.amountPaise > limit);
    if (i < 0) return { status: "pass" };
    const r = extracted.rows[i];
    return { status: "fail", message: `${r.ref} is above ₹${formatInr(limit / 100)}`, evidence: { quote: `${r.ref} ${paiseToRupees(r.amountPaise)}`, location: rowLoc(i) } };
  },
  "echo.party-listed": ({ extracted }, rule): CheckOutcome => {
    const listed = new Set((Array.isArray(rule.params?.parties) ? rule.params.parties : []).map((p) => String(p).trim().toLowerCase()));
    const i = extracted.rows.findIndex((r) => listed.has(r.party.trim().toLowerCase()));
    if (i < 0) return { status: "pass" };
    return { status: "fail", message: `${extracted.rows[i].party} is on the watch list`, evidence: { quote: extracted.rows[i].party, location: rowLoc(i) } };
  },
});

export const ECHO_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: ECHO_KEY,
  version: "1.0.0",
  rules: [
    { id: "echo.duplicate-refs", title: "No duplicate references", severity: "block", kind: "deterministic", check: "echo.duplicate-refs", evidence: "the reference and both rows", failMessage: "Duplicate reference in the register" },
    { id: "echo.round-amounts", title: "Large round amounts reviewed", severity: "warn", kind: "deterministic", check: "echo.round-amounts", evidence: "the row with the round amount" },
    { id: "echo.weekend-dates", title: "Entries dated on a weekend", severity: "info", kind: "deterministic", check: "echo.weekend-dates", evidence: "the date and row" },
    {
      id: "echo.related-party",
      title: "Related parties identified",
      severity: "warn",
      kind: "llm",
      check: "Is any party in the register described as a director, partner, relative or group company of the client (a related party)?",
      evidence: "the party name as written and its row",
    },
  ],
};

// ------------------------------------------------------------------ scope (ADR-008)

/**
 * Wrong-department sniff: register.csv must start with the register header. A missing or empty
 * register is left to the input schema (it names what is missing).
 */
export function echoInputSniff(files: SniffFile[]): InputSniffResult {
  const f = findRegister(files);
  const text = f?.bytes.toString("utf8").replace(/^﻿/, "").trim() ?? "";
  if (!f || !text) return { ok: true };
  const first = text.split(/\r?\n/)[0];
  const header = splitCsvLine(first).map((h) => h.toLowerCase());
  if (header.join(",") === ECHO_COLUMNS.join(",")) return { ok: true };
  const gst = header.some((h) => /gstin|taxable|\bhsn\b|igst|cgst|sgst/.test(h));
  const tb = header.includes("debit") && header.includes("credit");
  return {
    ok: false,
    reason: `${ECHO_REGISTER_FILE} header must be ${ECHO_COLUMNS.join(",")} (found "${first.slice(0, 120)}")${gst ? "; it looks like a GST register" : tb ? "; it looks like a trial balance" : ""}`,
    suggestAgent: gst ? "gst" : tb ? "books" : undefined,
  };
}

/** The cited row must be a row the model was shown ("register.csv row N: …" in the documents). */
export function validateEchoVerdict(v: ScopedVerdict, documents: string): string[] {
  if (v.status === INSUFFICIENT_EVIDENCE || !v.evidence) return [];
  const loc = v.evidence.location.trim().toLowerCase();
  return documents.split(/\r?\n/).some((l) => l.toLowerCase().startsWith(`${loc}:`)) ? [] : [`location "${v.evidence.location}" is not a register row shown`];
}

export const ECHO_RELATED_PARTY_SPEC: ModelTaskSpec<ScopedVerdict, string> = {
  name: ECHO_RELATED_PARTY_TASK,
  version: 2,
  schema: ScopedVerdictSchema,
  systemPrompt: [
    CHECK_TASK_INSTRUCTIONS,
    "A related party is a director, partner or relative of the client, or a group company, as described in the register itself. A party name alone does not show a relationship.",
  ].join("\n"),
  validate: validateEchoVerdict,
  highStakes: true,
  difficulty: "judgement",
  ruleIds: ["echo.related-party"],
};

export const ECHO_SCOPE: AgentScope = {
  department: "Books",
  tasks: [ECHO_RELATED_PARTY_SPEC],
  ruleIds: ECHO_CHECKLIST.rules.map((r) => r.id),
  inputSniff: echoInputSniff,
};

// ------------------------------------------------------------------ agent

export const echoAgent: AgentDefinition<EchoInput, EchoExtract> = {
  key: ECHO_KEY,
  title: "Echo (framework test)",
  service: "Books",
  sopPackKey: ECHO_KEY,
  modelAgent: "system",
  internal: true,
  inputSchema: echoInputSchema,
  defaultChecklist: ECHO_CHECKLIST,
  checklistRegistry: echoRegistry,
  probeMutation: echoProbeMutation,
  inputProbes: [{ input: ECHO_REGISTER_FILE, mutate: echoProbeMutation }],
  requiredInputs: [ECHO_REGISTER_FILE],
  scope: ECHO_SCOPE,

  // No model call: the rows are the code parse of register.csv (inputSchema). The model only
  // answers the related-party LLM rule.
  async extract({ input }) {
    return EchoExtractSchema.parse({ rows: input.rows });
  },

  compute({ rows }) {
    let total = 0;
    let largest = 0;
    for (const r of rows) {
      total += r.amountPaise;
      if (r.amountPaise > largest) largest = r.amountPaise;
    }
    return { rowCount: rows.length, totalPaise: total, largestPaise: largest };
  },

  llmContext({ extracted }) {
    return extracted.rows.map((r, i) => `${rowLoc(i)}: ${r.ref} | ${r.party} | ${r.date} | ${paiseToRupees(r.amountPaise)}`).join("\n");
  },

  deliverables({ extracted, figures }) {
    return [
      {
        type: "xlsx",
        title: "Echo register",
        sheets: [
          {
            name: "Register",
            columns: [
              { key: "ref", header: "Ref" },
              { key: "party", header: "Party", width: 32 },
              { key: "date", header: "Date", type: "date" },
              { key: "amount", header: "Amount", type: "inr" },
            ],
            rows: extracted.rows.map((r) => ({ ref: r.ref, party: r.party, date: r.date, amount: r.amountPaise / 100 })),
            totals: true,
          },
          {
            name: "Summary",
            columns: [
              { key: "figure", header: "Figure", width: 28 },
              { key: "amount", header: "Amount", type: "inr" },
              { key: "count", header: "Count", type: "integer" },
            ],
            rows: [
              { figure: "Total of register", amount: figures.totalPaise / 100 },
              { figure: "Largest entry", amount: figures.largestPaise / 100 },
              { figure: "Entries", count: figures.rowCount },
            ],
          },
        ],
      },
    ];
  },
};

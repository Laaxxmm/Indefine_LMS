// "Echo" — a dummy task agent that exercises the whole framework (Phase 4 QA gate). Input is a
// small register (register.csv: ref,party,date,amount); the model turns it into rows; code adds
// them up; three deterministic rules (block / warn / info) and one LLM rule check it; one XLSX
// deliverable is produced. Two parameterised checks (amount-over, party-listed) are registered
// but not in the default pack: approved MistakeLog rules use them (supervised loop tests).
// Hidden from the UI unless FIRM_OS_ECHO_AGENT is on (src/lib/agents/flags.ts).
import { z } from "zod";
import { createRuleRegistry, type ChecklistPack, type CheckOutcome } from "@/lib/agents/core/checklist";
import { formatInr } from "@/lib/agents/core/format";
import type { AgentDefinition, CheckInput, InputFile } from "@/lib/agents/core/runner";

export const ECHO_KEY = "echo";
export const ECHO_EXTRACT_TASK = "system.echo-extract" as const;

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
export type EchoInput = { fileName: string; csv: string };
export type EchoCheckInput = CheckInput<EchoInput, EchoExtract>;

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

export const echoInputSchema = z
  .array(InputFileZ)
  .transform((files, ctx): EchoInput => {
    const f = files.find((x) => x.name.toLowerCase() === "register.csv");
    const csv = f?.bytes.toString("utf8").trim() ?? "";
    if (!f) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "register.csv is missing from the client documents" });
    else if (!csv) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "register.csv is empty" });
    return { fileName: f?.name ?? "register.csv", csv };
  }) as unknown as z.ZodType<EchoInput, z.ZodTypeDef, InputFile[]>;

// ------------------------------------------------------------------ rules

const rowLoc = (i: number) => `register.csv row ${i + 2}`; // +1 header, +1 one-based
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
      evidence: { quote: `${r.ref},${r.party},${r.date},${(r.amountPaise / 100).toFixed(2)}`, location: rowLoc(i) },
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
    return { status: "fail", message: `${r.ref} is above ₹${formatInr(limit / 100)}`, evidence: { quote: `${r.ref} ${(r.amountPaise / 100).toFixed(2)}`, location: rowLoc(i) } };
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

  async extract({ input, notes, model }) {
    return model({
      task: ECHO_EXTRACT_TASK,
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      schema: EchoExtractSchema,
      messages: [
        {
          role: "system",
          content:
            "Convert the register into rows. Copy ref and party exactly as written. date is YYYY-MM-DD. amountPaise is the amount in paise as an integer (₹1,234.50 → 123450). Do not add up or total anything.",
        },
        { role: "user", content: `${notes ? `Reviewer notes: ${notes}\n\n` : ""}${input.fileName}:\n${input.csv}` },
      ],
    });
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
    return extracted.rows.map((r, i) => `${rowLoc(i)}: ${r.ref} | ${r.party} | ${r.date} | ${(r.amountPaise / 100).toFixed(2)}`).join("\n");
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

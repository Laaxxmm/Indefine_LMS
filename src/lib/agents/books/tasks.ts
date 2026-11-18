// Books Close model-task registry (ADR-008 §1, §8): every model task this agent may run, with its
// version, system prompt, output schema (built per call from the input — closed enums), the rule
// ids it serves and its deterministic validator. Nothing else in src/lib/agents/books calls a model.
//
// The registry IS the agent's AgentScope task list (index.ts). The framework prefixes the system
// prompt with the firm and Books department preambles; the call supplies its own closed schema
// (`schemaPerCall`: candidate line ids and the client's own ledgers as enums), which must have the
// shape of the template below; the call-specific validator (`validateCall`, needs the call's bank
// lines) is passed as the call's `contradictions`.
import type { ModelTaskSpec } from "@/lib/agents/core/guardrails/scope";
import type { BankLine } from "./bank";
import { BOOKS_CLASSIFY_TASK, BOOKS_CLASSIFY_VERSION, CLASSIFY_SYSTEM, classifySchema, validateClassification, type ClassifyOutput } from "./classify";

export type BooksModelTask = ModelTaskSpec<ClassifyOutput, unknown, "books"> & {
  name: typeof BOOKS_CLASSIFY_TASK;
  /** Output schema for one call (enums: candidate line ids; the client's ledgers + "insufficient_evidence"). */
  outputSchema: (lines: BankLine[], heads: string[]) => ReturnType<typeof classifySchema>;
  /** Checklist rules that read this task's output. */
  rules: string[];
  /** Deterministic validator for one call, passed as the call's `contradictions` (issues → escalate). */
  validateCall: (output: ClassifyOutput, lines: BankLine[]) => string[];
};

/** Template of the per-call schema (one placeholder line id and ledger): the shape every call's schema must have. */
export const CLASSIFY_SCHEMA_TEMPLATE = classifySchema([{ id: "S1" } as BankLine], ["(client ledger)"]);

export const BOOKS_MODEL_TASKS: readonly BooksModelTask[] = Object.freeze([
  {
    name: BOOKS_CLASSIFY_TASK,
    version: BOOKS_CLASSIFY_VERSION,
    systemPrompt: CLASSIFY_SYSTEM,
    schema: CLASSIFY_SCHEMA_TEMPLATE,
    schemaPerCall: true,
    difficulty: "sop",
    outputSchema: classifySchema,
    rules: ["books.suggestions-low-confidence", "books.classification-questions"],
    ruleIds: ["books.suggestions-low-confidence", "books.classification-questions"],
    validateCall: validateClassification,
    privacy: "anonymize-then-cloud",
    profile: {
      documents: "Bank debits not yet in the books (id, date, narration, reference, amount) and the client's own expense / purchase ledger names as the allowed heads (each screened); reviewer notes.",
      validators: "validateClassification per call: quote in the line text, location names the line, numbers in the quote are the line's; per-call closed enums of line ids and the client's ledgers.",
    },
  },
]);

/** `<task>@<version>` ids (ModelCall records task@version). */
export const booksTaskIds = () => BOOKS_MODEL_TASKS.map((t) => `${t.name}@${t.version}`);

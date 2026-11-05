// Books Close model-task registry (ADR-008 §1, §8): every model task this agent may run, with its
// version, system prompt, output schema (built per call from the input — closed enums), the rule
// ids it serves and its deterministic validator. Nothing else in src/lib/agents/books calls a model.
import type { BankLine } from "./bank";
import { BOOKS_CLASSIFY_TASK, BOOKS_CLASSIFY_VERSION, CLASSIFY_SYSTEM, classifySchema, validateClassification, type ClassifyOutput } from "./classify";

export type BooksModelTask = {
  name: typeof BOOKS_CLASSIFY_TASK;
  version: number;
  systemPrompt: string;
  /** Output schema for one call (enums: candidate line ids; the client's ledgers + "insufficient_evidence"). */
  outputSchema: (lines: BankLine[], heads: string[]) => ReturnType<typeof classifySchema>;
  /** Checklist rules that read this task's output. */
  rules: string[];
  /** Deterministic validator, wired as the router's `contradictions` (issues → escalate). */
  validate: (output: ClassifyOutput, lines: BankLine[]) => string[];
};

export const BOOKS_MODEL_TASKS: readonly BooksModelTask[] = Object.freeze([
  {
    name: BOOKS_CLASSIFY_TASK,
    version: BOOKS_CLASSIFY_VERSION,
    systemPrompt: CLASSIFY_SYSTEM,
    outputSchema: classifySchema,
    rules: ["books.suggestions-low-confidence", "books.classification-questions"],
    validate: validateClassification,
  },
]);

/** `<task>@<version>` ids (ModelCall records task@version once the framework adds it). */
export const booksTaskIds = () => BOOKS_MODEL_TASKS.map((t) => `${t.name}@${t.version}`);

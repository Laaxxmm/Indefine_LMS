// What AgentRun.error may hold (re-audit NEW-5). AgentRun.error is the failure's technical
// classification for IT and the audit; the run page and the run API show runFailureMessage(error)
// (src/lib/errors) instead. Rows are kept, so a thrown error's message is never stored as it is: a
// parser, a validator or a provider can quote a cell, a PAN or a person's name in it.
//
//   known classes       a fixed text — spreadsheet limits (by problem, never the sheet name), a
//                       refused input file (never its name), the AI provider ("provider: Claude
//                       unavailable (529)", call-errors.ts), the AI budget and input size (the
//                       error's own fixed text), zod validation (paths and codes only, never the
//                       value received)
//   everything else     the message through scrubFreeText (identifiers, the client's names and every
//                       name the free-text extractor finds become tokens); when the independent
//                       detector still finds client data in the result, the detail is withheld
//
// Pure: no I/O.
import { ZodError, type ZodIssue } from "zod";
import { detectPii } from "@/lib/ai/anonymizer";
import { providerErrorCode } from "@/lib/ai/call-errors";
import { BudgetExceededError, NoProviderAvailableError, ProviderError, ProviderUnavailableError } from "@/lib/ai/errors";
import type { DictionaryEntry } from "@/lib/ai/types";
import { scrubFreeText } from "@/lib/corrections/mask";
import { XlsxLimitError, type XlsxProblem } from "@/lib/hardening/xlsx-guard";
import { InputRejectedError, InputTooLargeError } from "./inputs";

/** Stored when the detail of an error still looked like client data after masking. */
export const RUN_ERROR_WITHHELD = "The run stopped. The details were withheld because they looked like client data. Run the agent again, or ask IT to check the server log.";

const XLSX_PROBLEM: Record<XlsxProblem, string> = {
  zip: "the file is damaged or is not a normal Excel file",
  encrypted: "the file is password-protected",
  entries: "it has too many parts inside it",
  size: "it unpacks to too much data",
  ratio: "it is packed far more tightly than a normal Excel file",
  rows: "a sheet has too many rows",
  columns: "a sheet has data too far to the right",
  cells: "it has too many cells",
  timeout: "it took too long to read",
  memory: "it needed too much memory to read",
};

const MAX_STORED = 2000;

/** A detail as it may be stored: masked, or withheld when the detector still finds client data in it. */
export function safeDetail(text: string, dictionary: readonly DictionaryEntry[] = []): string {
  const scrubbed = scrubFreeText(text.slice(0, 4000), dictionary).slice(0, MAX_STORED);
  return detectPii(scrubbed, { dictionary: [...dictionary], names: true }).length ? RUN_ERROR_WITHHELD : scrubbed;
}

/** A zod issue without the value it received ("Invalid enum value. Expected 'A' | 'B', received 'Rajesh …'" → "entity: must be one of A, B"). */
export function zodIssueText(issue: ZodIssue): string {
  const path = issue.path.length ? issue.path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".") : "input";
  switch (issue.code) {
    case "invalid_enum_value":
    case "invalid_union_discriminator":
      return `${path}: must be one of ${issue.options.map(String).join(", ")}`;
    case "invalid_literal":
      return `${path}: must be ${JSON.stringify(issue.expected)}`;
    case "invalid_type":
      return `${path}: expected ${issue.expected}, got ${issue.received}`;
    default:
      return issue.message; // the schema's own sentence ("register.csv is missing"); masked by the caller
  }
}

/** The AgentRun.error classification for a failed run (see the header). */
export function storedRunError(e: unknown, dictionary: readonly DictionaryEntry[] = []): string {
  if (e instanceof XlsxLimitError) return `A spreadsheet in the inputs could not be read safely because ${XLSX_PROBLEM[e.problem] ?? "it is too large"}. Split it into smaller files, for example one month or one sheet per file, and run the agent again.`;
  if (e instanceof InputRejectedError) return "One of the input files was refused because of its type, its size or the virus check. Check the files in the job's client documents folder and run the agent again.";
  if (e instanceof InputTooLargeError || e instanceof BudgetExceededError) return e.message.slice(0, MAX_STORED); // fixed text: sizes and amounts only
  if (e instanceof ProviderError || e instanceof ProviderUnavailableError) return providerErrorCode(e.provider, e);
  if (e instanceof NoProviderAvailableError) return "provider: no AI provider was available";
  if (e instanceof ZodError) return safeDetail(`Inputs incomplete: ${e.issues.slice(0, 5).map(zodIssueText).join("; ")}`, dictionary);
  return safeDetail(e instanceof Error ? e.message : String(e), dictionary);
}

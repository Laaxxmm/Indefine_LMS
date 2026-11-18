// What OnboardingRun.error and a step's `error` (OnboardingRun.steps) may hold: the same rule as
// AgentRun.error (src/lib/agents/core/run-errors.ts). The stored value is the failure's technical
// classification for IT and the audit; the onboarding page shows onboardingFailureMessage(stored)
// (src/lib/errors) instead. Rows are kept, so a thrown error's message is never stored as it is: a
// duplicate check names the existing client, a Microsoft 365 failure carries the site and file path
// and the response body, a database error can quote a value.
//
//   known classes    a fixed text: who refused and the status or code, never a client, file or sheet
//                    name, a path or a received value
//   everything else  the message through scrubFreeText with the run's dictionary (the client's names,
//                    the contact and the two people), withheld whole when the independent detector
//                    still finds client data in the result
//
// Pure: no I/O.
import { ZodError } from "zod";
import type { DictionaryEntry } from "@/lib/ai/types";
import { clientDictionary } from "@/lib/corrections/mask";
import { safeDetail, zodIssueText } from "@/lib/agents/core/run-errors";
import type { OnboardingPlan } from "./plan";
import type { StepKey } from "./saga";

/** Stored when the detail of an error still looked like client data after masking. */
export const ONBOARDING_ERROR_WITHHELD = "The step stopped. The details were withheld because they looked like client data. Use Resume to try again, or ask IT to check the server log.";

/** Where a step's outside calls go, for errors that do not say it themselves (timeouts, network). */
const STEP_SERVICE: Partial<Record<StepKey, string>> = { turia: "Turia", sharepoint: "Microsoft 365", assignment: "Turia" };

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; status?: unknown };

const nameOf = (e: unknown) => (e && typeof e === "object" ? String((e as ErrorLike).name ?? "") : "");
const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "");

/**
 * The masking dictionary for an onboarding run's errors: the client's legal name (with its parts
 * for an individual), the contact person, and the assignee and reviewer (staff, ADR-006 class B).
 */
export function onboardingErrorDictionary(spec: Record<string, unknown> | null | undefined, plan: Pick<OnboardingPlan, "people"> | null | undefined): DictionaryEntry[] {
  const s = spec ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const people = [str(s.assigneeName), str(s.reviewerName), plan?.people?.assignee?.name ?? null, plan?.people?.reviewer?.name ?? null];
  return [
    ...clientDictionary({ name: str(s.legalName), contactName: str(s.contactName), entityType: str(s.entityType) }),
    ...people.filter((p): p is string => !!p && p.trim().length >= 3).flatMap((p) => clientDictionary({ name: p, entityType: "INDIVIDUAL" })),
  ];
}

/** The OnboardingRun.error / step error classification for a thrown error (see the header). */
export function storedOnboardingError(e: unknown, dictionary: readonly DictionaryEntry[] = [], step?: StepKey): string {
  const name = nameOf(e);
  const message = messageOf(e);
  const err = (e && typeof e === "object" ? e : {}) as ErrorLike;
  const service = step ? STEP_SERVICE[step] : undefined;

  // A person must act first (setup): the step's `action` keeps what to do; the error only says so.
  if (name === "TuriaBlockedError") return "BLOCKED (Turia): waiting for the setup step recorded as the step's action";
  if (name === "BlockedError") return "BLOCKED: waiting for the setup step recorded as the step's action";

  // Microsoft 365 / SharePoint: status and method only (the URL and the body can name the client or a file).
  if (name === "GraphError" && typeof err.status === "number") {
    const method = /^(GET|POST|PUT|PATCH|DELETE)\b/.exec(message)?.[1] ?? "A";
    return `Microsoft 365: ${method} request failed: ${err.status}`;
  }
  if (name === "UnsafeUrlError") return "Microsoft 365: a request to an address outside the firm's tenant was refused";
  if (name === "NotProvisionedError") return "SharePoint: the client's site or library is not ready yet";
  if (name === "ConflictError") return "SharePoint: a file already exists where one was to be created";
  if (name === "PathError") return "SharePoint: a folder or file name was outside the folder contract";

  // The LMS client record.
  if (name === "ClientExistsError") return "LMS client: a client with the same name, folder name or PAN already exists";
  if (name === "ClientNameError") return "LMS client: the client name cannot be used as a folder name";

  // The database (Prisma, recognised without importing it): the code only, never the message.
  if (typeof err.code === "string" && /^P\d{4}$/.test(err.code)) return `database: ${err.code}`;
  if (/^PrismaClient(?:Initialization|RustPanic|Unknown)/.test(name)) return "database: unavailable";

  // Timeouts and the network, named by the step's service.
  if (name === "AbortError" || name === "TimeoutError" || /\b(?:ETIMEDOUT|timed? ?out)\b/i.test(message)) return `${service ?? "A request"}: timed out`;
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) return `${service ?? "network"}: could not be reached`;

  // Validation: paths and codes only, never the value received.
  if (e instanceof ZodError) return safeDetail(`Details not valid: ${e.issues.slice(0, 5).map(zodIssueText).join("; ")}`, dictionary, ONBOARDING_ERROR_WITHHELD);

  return safeDetail(message || String(e), dictionary, ONBOARDING_ERROR_WITHHELD);
}

// ADR-008 agent guardrails: the public surface agents and tooling import. Explicit names only.
export {
  CHECK_TASK_INSTRUCTIONS,
  DEPARTMENT_LABELS,
  FIRM_PREAMBLE,
  ScopeViolationError,
  WrongInputError,
  checkTaskFor,
  checkTaskName,
  composeSystemPrompt,
  departmentPreamble,
  genericCheckTaskName,
  resolveTask,
  sniffInputs,
  taskLabel,
  validateScope,
  wrongInputMessage,
} from "./scope";
export type { AgentScope, AnyTaskSpec, InputSniffResult, ModelTaskSpec, ScopedAgentLike, SniffFile } from "./scope";

export {
  INSUFFICIENT_EVIDENCE,
  NOTE_MAX,
  ScopedVerdictSchema,
  abstainable,
  evidence,
  groundedNumber,
  groundedNumberInfo,
  groundedNumberPaths,
  hasAbstainOption,
  note,
  schemaFingerprint,
  shapeFingerprint,
  unboundedStrings,
} from "./schema";
export type { InsufficientEvidence, ScopedVerdict } from "./schema";

export { GroundingError, groundCheck, numberInQuote, numbersIn } from "./grounding";
export type { GroundIssue, GroundResult } from "./grounding";

export { AGREEMENT_TIER, needsAgreement, settleAgreement } from "./agreement";

export { GUARDRAIL_RUN_ACTION, createGuardrailSession, emptyGuardrailStats } from "./session";
export type { GuardrailSession, GuardrailSessionDeps, GuardrailStats, ModelCallRequest } from "./session";

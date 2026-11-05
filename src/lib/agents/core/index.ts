// Public surface of the Firm OS agent core. Explicit names only (no `export *`): the close-gate
// registration in state.ts is deliberately NOT exported here — only src/lib/close-loop/gate.ts
// may import it, straight from "./state" (see docs/superpowers/specs/2026-11-05-agent-core-design.md).

export {
  ACK_REF_MAX,
  ACK_REF_REQUIRED,
  CLOSE_GATE_TOKEN_TTL_MS,
  JOB_TASK_STATES,
  actorRef,
  canTransition,
  gateTokenProblem,
  isJobTaskState,
  isLegalEdge,
  nextStates,
  transitionTable,
} from "./state";
export type {
  Actor,
  CloseGateToken,
  DenyCode,
  EdgeName,
  FirmRole,
  GateTokenProblem,
  JobTaskState,
  TransitionContext,
  TransitionDecision,
} from "./state";

export { transitionJobTask, updateFor } from "./state-db";
export type { JobTaskDb, JobTaskRow, JobTaskTx, JobTaskUpdate, TransitionOptions, TransitionResult } from "./state-db";

export {
  ChecklistPackSchema,
  MistakeRuleProposalSchema,
  RuleDefinitionSchema,
  SEVERITIES,
  bumpMinor,
  createRuleRegistry,
  hasBlockingFailures,
  loadRuleSet,
  rulesFromMistakeLogs,
  runChecklist,
  summarizeChecklist,
  toChecklistResultRows,
  withPromotedRule,
} from "./checklist";
export type {
  CheckOutcome,
  CheckStatus,
  ChecklistPack,
  ChecklistResultItem,
  ChecklistSummary,
  DeterministicCheck,
  Evidence,
  LlmCheck,
  LlmVerdict,
  LoadResult,
  MistakeLogLike,
  ResultFlag,
  ResultSource,
  RuleDefinition,
  RuleKind,
  RuleRegistry,
  RuleSet,
  Severity,
} from "./checklist";

export { DATE_NUMFMT, INR_NUMFMT, formatDate, formatDateTimeIst, formatDayKey, formatInr, groupIndian, toPaise } from "./format";

export {
  DOCX_MIME,
  DRAFT_LABEL,
  DeliverableHeaderSchema,
  LAYOUT,
  PRODUCER,
  XLSX_MIME,
  buildDocx,
  buildWorkbook,
  columnTotal,
  deliverableFileName,
  formatCell,
  headerFields,
} from "./templates";
export type { BuiltDeliverable, CellValue, ColumnSpec, ColumnType, DeliverableHeader, DocBlock, DocxSpec, RowSpec, SheetSpec, WorkbookSpec } from "./templates";

export {
  CalendarPackSchema,
  CalendarRuleSchema,
  PERIOD_KINDS,
  dueDatesFor,
  dueDatesForFy,
  holidaysFrom,
  isWorkingDay,
  onOrBeforeWorkingDay,
  packDueDates,
  parseCalendarPack,
  parseFy,
  parsePeriod,
  periodsFor,
  shiftDayKey,
} from "./calendar";
export type { CalendarPack, CalendarRule, DueContext, DueDates, DueErrorCode, DueOptions, DueResult, DueSpec, ParsedPeriod, PeriodKind, WorkingDayOptions } from "./calendar";

export { DEFAULT_CALENDAR, defaultCalendarJson } from "./calendar-defaults";

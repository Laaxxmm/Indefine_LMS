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

export { AgentRunError, INPUTS_RETENTION_DAYS, LLM_CHECK_SYSTEM, LlmVerdictOutputSchema, jobFolder, latestPackQuery, runAgent } from "./runner";
export type {
  AgentDefinition,
  AnyAgent,
  CheckInput,
  DeliverableContext,
  DeliverableDraft,
  ExtractContext,
  Figures,
  FirmDb,
  InputFile,
  InputRequest,
  InputSource,
  InputSourceKind,
  JobContext,
  ModelCaller,
  ModelRouterLike,
  PreconditionCode,
  RunOptions,
  RunOutcome,
  RunnerDeps,
} from "./runner";

export { MistakeExampleSchema, decideMistake, diffPacks, proposeMistake, replayMistake } from "./mistakes";
export type { Decision, HumanActor, MistakeDeps, MistakeExample, MistakeResult, PackDiff, RuleChange } from "./mistakes";

export { InputTooLargeError, MAX_INPUT_BYTES, clientDocsInputSource, combineInputSources, defaultInputSource, emptyInputSource, staticInputSource } from "./inputs";
export { PREVIEW_MAX_COLS, PREVIEW_MAX_ROWS, checkWorkbookShape, previewWorkbook } from "./preview";
export type { PreviewSheet, SheetShape, WorkbookPreview } from "./preview";
export { MissingRecordingError, createRecordedRouter } from "./recorded-router";
export type { RecordedResponses, RecordedRouter } from "./recorded-router";
export { UniqueConstraintError, createMemoryDb } from "./memory-db";
export type { MemoryDb } from "./memory-db";
export { createMemoryStore } from "./memory-store";
export type { MemoryStore } from "./memory-store";
export {
  ACCURACY_THRESHOLDS,
  FixtureExpectedSchema,
  SCOREBOARD_END,
  SCOREBOARD_START,
  canonicalOutcome,
  compareFigures,
  countFlags,
  failureDetails,
  prf,
  sameEveryRun,
  scoreAgent,
  scoreboardMarkdown,
  upsertScoreboard,
} from "./accuracy";
export type { AgentScore, Counts, FigureDiff, FixtureExpected, FixtureOutcome, FixtureRuns, Flag, Prf, ReplayOutcome, Thresholds } from "./accuracy";

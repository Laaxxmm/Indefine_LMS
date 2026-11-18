// TuriaAdapter (ADR-003, docs/turia-bridge.md). Turia (practice.turia.in) is the firm's source
// of truth for clients, services, tasks and time, and it has no documented API. Every write to
// Turia therefore goes through one of three bridges behind this interface:
//
//   ManualBridge       (default, active) numbered checklist for staff + recorded confirmation
//   UiAutomationBridge (stub, disabled)  Playwright against the Turia web app — not built
//   ApiBridge          (not available)   only if Turia ever documents an API
//
// The interface deliberately has NO delete or archive operation (orchestrator NON-NEGOTIABLE
// #2). Closing a task is the only "end of life" operation and it is a normal Turia workflow.
import type { EntityType, FirmService, TuriaSyncStatus } from "@prisma/client";

export type TuriaMode = "MANUAL" | "UI" | "API";
export type TuriaOperation = "createClient" | "addService" | "createTask" | "closeTask";
export type ServiceFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

// ---------------------------------------------------------------- inputs

export interface TuriaClientInput {
  firmClientId: string;
  clientCode: string;
  legalName: string;
  entityType: EntityType;
  pan?: string | null;
  gstins?: string[];
  cin?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billing?: string | null;
}

export interface TuriaServiceInput {
  firmClientId: string;
  clientCode: string;
  legalName: string;
  service: FirmService;
  frequency: ServiceFrequency;
  assigneeName: string;
  reviewerName?: string | null;
  firstPeriod?: string | null;
}

export interface TuriaTaskInput {
  firmClientId: string;
  jobTaskId: string;
  clientCode: string;
  legalName: string;
  service: FirmService;
  title: string;
  fy: string;
  period: string;
  assigneeName: string;
  reviewerName?: string | null;
  dueOn?: Date | null;
}

export interface TuriaCloseContext {
  jobTaskId?: string | null;
  firmClientId?: string | null;
  clientCode?: string | null;
  title?: string | null;
}

// ---------------------------------------------------------------- results

export interface ChecklistValue {
  label: string;
  value: string;
}

export interface ChecklistStep {
  n: number;
  text: string;
  /** Values to type in this step; the UI shows a copy button for each. */
  values?: ChecklistValue[];
}

/** What a person must do in Turia, in order, with every value prefilled. */
export interface TuriaChecklist {
  operation: TuriaOperation;
  title: string;
  steps: ChecklistStep[];
  /** What to paste back into Firm OS when done. */
  confirmWith: { turiaRefLabel: string; minutesRequired: boolean };
}

export interface TuriaOpResult {
  mode: TuriaMode;
  operation: TuriaOperation;
  syncId: string;
  status: TuriaSyncStatus;
  turiaRef: string | null;
  /** Present for ManualBridge: the steps for staff. */
  checklist?: TuriaChecklist;
  /** True when an earlier identical request was found and reused (idempotent re-run). */
  reused: boolean;
}

export type TuriaLookup =
  | { status: "found"; turiaRef: string }
  | { status: "not-found" }
  /** The bridge cannot look Turia up; `checklistItem` is the human check to do instead. */
  | { status: "unknown"; reason: string; checklistItem: string };

export interface TuriaAdapter {
  readonly mode: TuriaMode;
  createClient(input: TuriaClientInput, actorId?: string | null): Promise<TuriaOpResult>;
  addService(input: TuriaServiceInput, actorId?: string | null): Promise<TuriaOpResult>;
  createTask(input: TuriaTaskInput, actorId?: string | null): Promise<TuriaOpResult>;
  closeTask(taskRef: string, minutes: number, ctx?: TuriaCloseContext, actorId?: string | null): Promise<TuriaOpResult>;
  findClientByCode(code: string): Promise<TuriaLookup>;
}

/** Every method name a TuriaAdapter exposes; the no-destructive test asserts nothing else exists. */
export const TURIA_ADAPTER_METHODS = ["createClient", "addService", "createTask", "closeTask", "findClientByCode"] as const;

export const SERVICE_LABELS: Record<FirmService, string> = {
  GST: "GST",
  ROC: "ROC",
  IncomeTax: "Income tax",
  TDS: "TDS",
  Books: "Books",
  Audit: "Audit",
  Engagement: "Engagement",
};

export const FREQUENCY_LABELS: Record<ServiceFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

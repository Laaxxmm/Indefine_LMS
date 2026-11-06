// ManualBridge — the active Turia bridge (ADR-003). Firm OS never writes to Turia itself: each
// operation produces an exact, numbered checklist with every value prefilled, records a
// TuriaSync row (mode MANUAL, status CHECKLIST_ISSUED) and waits for a person to confirm with
// the Turia reference. confirm() moves the row to CONFIRMED (or CLOSED for closeTask, with the
// minutes logged). Re-issuing the same operation returns the existing row — never a duplicate.
//
// The steps describe what to do, not Turia's exact menu labels: Turia's UI is not documented
// and we do not guess at it.
import type { TuriaSyncStatus } from "@prisma/client";
import { ENTITY_TYPES } from "@/lib/clients/core";
import { istLabel } from "@/lib/ist";
import {
  FREQUENCY_LABELS, SERVICE_LABELS,
  type ChecklistStep, type ChecklistValue, type TuriaAdapter, type TuriaChecklist, type TuriaClientInput, type TuriaCloseContext,
  type TuriaLookup, type TuriaMode, type TuriaOpResult, type TuriaOperation, type TuriaServiceInput, type TuriaTaskInput,
} from "./adapter";
import { TuriaConfirmError } from "./errors";

export const TURIA_HOST = "practice.turia.in";

// ---------------------------------------------------------------- persistence port

export interface TuriaEvidence {
  /** Idempotency key: operation + client + service/task. */
  key: string;
  checklist?: TuriaChecklist;
  issuedById?: string | null;
  confirmedAt?: string;
  note?: string;
}

export interface TuriaSyncRecord {
  id: string;
  jobTaskId: string | null;
  firmClientId: string | null;
  operation: TuriaOperation;
  mode: TuriaMode;
  status: TuriaSyncStatus;
  turiaRef: string | null;
  minutesLogged: number | null;
  evidence: TuriaEvidence | null;
  confirmedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTuriaSync {
  jobTaskId: string | null;
  firmClientId: string | null;
  operation: TuriaOperation;
  mode: TuriaMode;
  status: TuriaSyncStatus;
  evidence: TuriaEvidence;
}

export interface TuriaSyncPatch {
  status: TuriaSyncStatus;
  turiaRef: string;
  minutesLogged: number | null;
  confirmedById: string;
  evidence: TuriaEvidence;
}

/** Where TuriaSync rows live. Production: Prisma (./db.ts). Tests: an in-memory map. */
export interface TuriaSyncRepo {
  findByKey(key: string): Promise<TuriaSyncRecord | null>;
  create(row: NewTuriaSync): Promise<TuriaSyncRecord>;
  get(id: string): Promise<TuriaSyncRecord | null>;
  update(id: string, patch: TuriaSyncPatch): Promise<TuriaSyncRecord>;
}

// ---------------------------------------------------------------- checklist text

const dayLabel = (d: Date) => istLabel(d, { day: "2-digit", month: "short", year: "numeric" });

function v(label: string, value: string | null | undefined): ChecklistValue[] {
  return value ? [{ label, value }] : [];
}

function numbered(items: Array<{ text: string; values?: ChecklistValue[] }>): ChecklistStep[] {
  return items.map((s, i) => ({ n: i + 1, text: s.text, ...(s.values && s.values.length ? { values: s.values } : {}) }));
}

const SIGN_IN = { text: `Sign in to Turia (${TURIA_HOST}) with your own login.` };

export function createClientChecklist(input: TuriaClientInput): TuriaChecklist {
  const gstins = input.gstins ?? [];
  const steps = [
    SIGN_IN,
    { text: "Search the client list for this client code. If a client with this code already exists, stop and report it to the partner instead of creating a second one.", values: v("Client code", input.clientCode) },
    { text: "Start a new client record and enter the client's legal name exactly as below.", values: v("Legal name", input.legalName) },
    { text: "Enter the client code.", values: v("Client code", input.clientCode) },
    { text: "Set the constitution / entity type.", values: v("Entity type", ENTITY_TYPES[input.entityType]) },
    ...(input.pan ? [{ text: "Enter the PAN.", values: v("PAN", input.pan) }] : []),
    ...(gstins.length ? [{ text: gstins.length > 1 ? "Enter each GSTIN." : "Enter the GSTIN.", values: gstins.map((g, i) => ({ label: gstins.length > 1 ? `GSTIN ${i + 1}` : "GSTIN", value: g })) }] : []),
    ...(input.cin ? [{ text: "Enter the CIN / LLPIN.", values: v("CIN / LLPIN", input.cin) }] : []),
    ...(input.contactName || input.contactEmail || input.contactPhone
      ? [{ text: "Enter the primary contact.", values: [...v("Contact name", input.contactName), ...v("Contact email", input.contactEmail), ...v("Contact phone", input.contactPhone)] }]
      : []),
    ...(input.billing ? [{ text: "Record the billing arrangement.", values: v("Billing", input.billing) }] : []),
    { text: "Save the client. Copy the client reference Turia shows for it, paste it into \"Turia client ref\" below and choose \"Done in Turia\"." },
  ];
  return {
    operation: "createClient",
    title: `Create client ${input.clientCode} in Turia`,
    steps: numbered(steps),
    confirmWith: { turiaRefLabel: "Turia client ref", minutesRequired: false },
  };
}

export function addServiceChecklist(input: TuriaServiceInput): TuriaChecklist {
  const steps = [
    SIGN_IN,
    { text: "Open the client.", values: [...v("Client code", input.clientCode), ...v("Legal name", input.legalName)] },
    { text: "Add the service with this frequency.", values: [...v("Service", SERVICE_LABELS[input.service]), ...v("Frequency", FREQUENCY_LABELS[input.frequency])] },
    ...(input.firstPeriod ? [{ text: "Set the first period the firm handles.", values: v("First period", input.firstPeriod) }] : []),
    { text: "Assign the people.", values: [...v("Assignee", input.assigneeName), ...v("Reviewer", input.reviewerName)] },
    { text: "Save. Paste the service reference Turia shows (or the client ref if Turia shows none) and choose \"Done in Turia\"." },
  ];
  return {
    operation: "addService",
    title: `Add ${SERVICE_LABELS[input.service]} (${FREQUENCY_LABELS[input.frequency].toLowerCase()}) for ${input.clientCode}`,
    steps: numbered(steps),
    confirmWith: { turiaRefLabel: "Turia service ref", minutesRequired: false },
  };
}

export function createTaskChecklist(input: TuriaTaskInput): TuriaChecklist {
  const taskName = `${input.title} — ${input.period} — FY ${input.fy}`;
  const steps = [
    SIGN_IN,
    { text: "Open the client.", values: [...v("Client code", input.clientCode), ...v("Legal name", input.legalName)] },
    { text: "Create a task under the service with this name.", values: [...v("Service", SERVICE_LABELS[input.service]), ...v("Task name", taskName)] },
    { text: "Assign it and set the due date.", values: [...v("Assignee", input.assigneeName), ...v("Reviewer", input.reviewerName), ...v("Due date", input.dueOn ? dayLabel(input.dueOn) : null)] },
    { text: "Save. Paste the task reference Turia shows and choose \"Done in Turia\"." },
  ];
  return {
    operation: "createTask",
    title: `Create task ${input.title} ${input.period} for ${input.clientCode}`,
    steps: numbered(steps),
    confirmWith: { turiaRefLabel: "Turia task ref", minutesRequired: false },
  };
}

export function closeTaskChecklist(taskRef: string, minutes: number, ctx: TuriaCloseContext = {}): TuriaChecklist {
  const steps = [
    SIGN_IN,
    { text: "Open the task.", values: [...v("Task ref", taskRef), ...v("Client code", ctx.clientCode), ...v("Task", ctx.title)] },
    { text: "Log the time spent.", values: v("Minutes", String(minutes)) },
    { text: "Mark the task complete in Turia." },
    { text: "Enter the task ref and the minutes you logged below and choose \"Done in Turia\"." },
  ];
  return {
    operation: "closeTask",
    title: `Close Turia task ${taskRef}`,
    steps: numbered(steps),
    confirmWith: { turiaRefLabel: "Turia task ref", minutesRequired: true },
  };
}

// ---------------------------------------------------------------- bridge

export interface ConfirmInput {
  turiaRef: string;
  minutes?: number | null;
  confirmedBy: string;
}

export const MAX_MINUTES = 100 * 60; // a single Turia time entry above 100 h is a typo

export class ManualBridge implements TuriaAdapter {
  readonly mode = "MANUAL" as const;

  constructor(private readonly repo: TuriaSyncRepo, private readonly now: () => Date = () => new Date()) {}

  private async issue(
    key: string,
    operation: TuriaOperation,
    checklist: TuriaChecklist,
    link: { firmClientId: string | null; jobTaskId: string | null },
    actorId: string | null | undefined,
  ): Promise<TuriaOpResult> {
    const existing = await this.repo.findByKey(key);
    if (existing && existing.status !== "FAILED") return this.result(existing, true);
    const row = await this.repo.create({
      ...link,
      operation,
      mode: "MANUAL",
      status: "CHECKLIST_ISSUED",
      evidence: { key, checklist, issuedById: actorId ?? null },
    });
    return this.result(row, false);
  }

  private result(row: TuriaSyncRecord, reused: boolean): TuriaOpResult {
    return {
      mode: "MANUAL",
      operation: row.operation,
      syncId: row.id,
      status: row.status,
      turiaRef: row.turiaRef,
      checklist: row.evidence?.checklist,
      reused,
    };
  }

  createClient(input: TuriaClientInput, actorId?: string | null): Promise<TuriaOpResult> {
    return this.issue(`createClient:${input.firmClientId}`, "createClient", createClientChecklist(input), { firmClientId: input.firmClientId, jobTaskId: null }, actorId);
  }

  addService(input: TuriaServiceInput, actorId?: string | null): Promise<TuriaOpResult> {
    return this.issue(`addService:${input.firmClientId}:${input.service}`, "addService", addServiceChecklist(input), { firmClientId: input.firmClientId, jobTaskId: null }, actorId);
  }

  createTask(input: TuriaTaskInput, actorId?: string | null): Promise<TuriaOpResult> {
    return this.issue(`createTask:${input.jobTaskId}`, "createTask", createTaskChecklist(input), { firmClientId: input.firmClientId, jobTaskId: input.jobTaskId }, actorId);
  }

  closeTask(taskRef: string, minutes: number, ctx: TuriaCloseContext = {}, actorId?: string | null): Promise<TuriaOpResult> {
    const ref = taskRef.trim();
    if (!ref) throw new TuriaConfirmError("invalid", "Enter the Turia task reference to close the task.");
    checkMinutes(minutes, true);
    return this.issue(`closeTask:${ctx.jobTaskId ?? ref}`, "closeTask", closeTaskChecklist(ref, minutes, ctx), { firmClientId: ctx.firmClientId ?? null, jobTaskId: ctx.jobTaskId ?? null }, actorId);
  }

  /** ManualBridge cannot see Turia: the lookup becomes a checklist item for a person. */
  async findClientByCode(code: string): Promise<TuriaLookup> {
    return {
      status: "unknown",
      reason: "The manual bridge cannot look Turia up.",
      checklistItem: `Search Turia (${TURIA_HOST}) for client code ${code} before creating the client; if it already exists, use that client and report it.`,
    };
  }

  /** A person did the checklist in Turia: record the reference (and minutes for closeTask). */
  async confirm(syncId: string, input: ConfirmInput): Promise<TuriaSyncRecord> {
    const row = await this.repo.get(syncId);
    if (!row) throw new TuriaConfirmError("not-found", "That Turia checklist wasn't found. Reload the page and try again.");
    const turiaRef = input.turiaRef.trim();
    if (!turiaRef) throw new TuriaConfirmError("invalid", "Enter the Turia reference.");
    if (turiaRef.length > 100) throw new TuriaConfirmError("invalid", "The Turia reference is too long. Keep it to 100 characters or fewer.");
    const closing = row.operation === "closeTask";
    const minutes = input.minutes ?? null;
    checkMinutes(minutes, closing);

    if (row.status === "CONFIRMED" || row.status === "CLOSED") {
      if (row.turiaRef === turiaRef) return row; // same confirmation twice — idempotent
      throw new TuriaConfirmError("conflict", `Already confirmed with Turia ref ${row.turiaRef}. Reload the page to see it.`);
    }
    return this.repo.update(syncId, {
      status: closing ? "CLOSED" : "CONFIRMED",
      turiaRef,
      minutesLogged: minutes,
      confirmedById: input.confirmedBy,
      evidence: { ...(row.evidence ?? { key: syncId }), confirmedAt: this.now().toISOString() },
    });
  }
}

function checkMinutes(minutes: number | null | undefined, required: boolean): void {
  if (minutes === null || minutes === undefined) {
    if (required) throw new TuriaConfirmError("invalid", "Enter the minutes logged in Turia.");
    return;
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new TuriaConfirmError("invalid", `Enter the minutes as a whole number from 1 to ${MAX_MINUTES.toLocaleString("en-IN")}.`);
  }
}

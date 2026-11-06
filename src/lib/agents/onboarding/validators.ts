// Validators — code, not a model (orchestrator Phase 3 task 3). The pure checks (PAN, GSTIN,
// CIN/LLPIN, client code shape, services, period) run anywhere; validateSpec() adds the lookups
// that need the database and Turia through injected ports.
import type { EntityType } from "@prisma/client";
import { GST_STATE_CODES, gstinCheckChar, isPanShape } from "@/lib/ai/anonymizer";
import { isValidFy } from "@/lib/clients/core";
import type { TuriaAdapter } from "@/lib/integrations/turia/adapter";
import {
  CLIENT_CODE_RE, COMPANY_TYPES, ENTITY_TYPES, MONTH_RE, SERVICE_FREQUENCIES, SERVICE_LABELS,
  type PartialSpec, type SpecField,
} from "./spec";
import { causeSentence } from "@/lib/errors";

export interface Issue {
  field: SpecField;
  message: string;
}

// ---------------------------------------------------------------- PAN

/**
 * 4th character of a PAN = holder status. A proprietorship files under the proprietor's own
 * (individual) PAN; societies hold AOP PANs.
 */
export const PAN_STATUS_BY_ENTITY: Partial<Record<EntityType, string[]>> = {
  INDIVIDUAL: ["P"],
  PROPRIETORSHIP: ["P"],
  HUF: ["H"],
  PARTNERSHIP: ["F"],
  LLP: ["F"],
  PVT_LTD: ["C"],
  PUBLIC_LTD: ["C"],
  TRUST_SOCIETY: ["T", "A"],
};

export function validatePan(pan: string, entityType?: EntityType | null): string | null {
  if (!isPanShape(pan)) return "PAN must be 10 characters: 5 letters, 4 digits, 1 letter (AAAAA9999A)";
  const allowed = entityType ? PAN_STATUS_BY_ENTITY[entityType] : undefined;
  if (allowed && !allowed.includes(pan[3])) {
    return `PAN ${pan} is not a ${ENTITY_TYPES[entityType!].toLowerCase()} PAN (4th character is ${pan[3]}, expected ${allowed.join(" or ")})`;
  }
  return null;
}

// ---------------------------------------------------------------- GSTIN

const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Every problem with one GSTIN: shape, state code, checksum, and the PAN embedded in it. */
export function validateGstin(gstin: string, pan?: string | null): string[] {
  if (gstin.length !== 15) return [`GSTIN ${gstin} must be 15 characters`];
  if (!GSTIN_SHAPE.test(gstin)) return [`GSTIN ${gstin} is not in the GSTIN format (2 digits, PAN, entity number, Z, check character)`];
  const issues: string[] = [];
  if (!GST_STATE_CODES.has(gstin.slice(0, 2))) issues.push(`GSTIN ${gstin} starts with ${gstin.slice(0, 2)}, which is not a GST state code`);
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) issues.push(`GSTIN ${gstin} fails the checksum (last character should be ${gstinCheckChar(gstin.slice(0, 14))})`);
  if (pan && gstin.slice(2, 12) !== pan) issues.push(`GSTIN ${gstin} belongs to PAN ${gstin.slice(2, 12)}, not ${pan}`);
  return issues;
}

/** Karnataka = 29. Used by the calendar for QRMP GSTR-3B state groups. */
export function gstStateCode(gstin: string): string | null {
  return GSTIN_SHAPE.test(gstin) ? gstin.slice(0, 2) : null;
}

// ---------------------------------------------------------------- CIN / LLPIN

/** L/U + 5-digit industry + state + year + ownership + 6-digit registration number. */
export const CIN_RE = /^([LU])(\d{5})([A-Z]{2})(\d{4})(PLC|PTC|FLC|FTC|GOI|SGC|NPL|GAP|GAT|ULL|ULT|OPC)(\d{6})$/;
export const LLPIN_RE = /^[A-Z]{3}-\d{4}$/;

export function validateCin(value: string, entityType?: EntityType | null): string | null {
  if (entityType === "LLP") return LLPIN_RE.test(value) ? null : "LLPIN must look like AAB-1234";
  const m = CIN_RE.exec(value);
  if (!m) return "CIN must be 21 characters, e.g. U12345KA2020PTC123456";
  const year = Number(m[4]);
  if (year < 1850 || year > 2100) return `CIN year ${m[4]} is not a valid incorporation year`;
  if (entityType === "PVT_LTD" && !["PTC", "OPC", "FTC", "NPL"].includes(m[5])) return `CIN ${value} is not a private company CIN (${m[5]})`;
  if (entityType === "PUBLIC_LTD" && !["PLC", "FLC", "GOI", "SGC", "NPL"].includes(m[5])) return `CIN ${value} is not a public company CIN (${m[5]})`;
  return null;
}

// ---------------------------------------------------------------- client code

export function validateClientCodeShape(code: string): string | null {
  if (code.length < 3 || code.length > 10) return "Client code must be 3–10 characters";
  if (!CLIENT_CODE_RE.test(code)) return "Client code may contain only A–Z and 0–9 (uppercase)";
  return null;
}

// ---------------------------------------------------------------- the rest of the spec (pure)

/** Field-level problems that need no lookup. Missing fields are the clarifier's job, not errors. */
export function validateFields(spec: PartialSpec): Issue[] {
  const issues: Issue[] = [];
  const add = (field: SpecField, message: string | null) => {
    if (message) issues.push({ field, message });
  };
  if (spec.clientCode) add("clientCode", validateClientCodeShape(spec.clientCode));
  if (spec.pan) add("pan", validatePan(spec.pan, spec.entityType));
  for (const g of spec.gstins ?? []) for (const m of validateGstin(g, spec.pan && isPanShape(spec.pan) ? spec.pan : null)) add("gstins", m);
  if (spec.cin) add("cin", validateCin(spec.cin, spec.entityType));
  if (spec.cin && spec.entityType && !COMPANY_TYPES.includes(spec.entityType) && spec.entityType !== "LLP") {
    add("cin", `A ${ENTITY_TYPES[spec.entityType].toLowerCase()} has no CIN/LLPIN`);
  }
  if (spec.fy && !isValidFy(spec.fy)) add("fy", "FY must look like 2026-27");
  for (const line of spec.services ?? []) {
    if (!SERVICE_FREQUENCIES[line.service].includes(line.frequency)) {
      add("services", `${SERVICE_LABELS[line.service]} cannot be ${line.frequency.toLowerCase()}`);
    }
  }
  if (spec.firstPeriod) {
    const m = MONTH_RE.exec(spec.firstPeriod);
    if (!m) add("firstPeriod", "First period must be a month, e.g. 2026-11");
    else if (spec.fy && isValidFy(spec.fy)) {
      const start = Number(spec.fy.slice(0, 4));
      if (spec.firstPeriod < `${start}-04` || spec.firstPeriod > `${start + 1}-03`) add("firstPeriod", `First period ${spec.firstPeriod} is outside FY ${spec.fy}`);
    }
  }
  if (spec.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(spec.contactEmail)) add("contactEmail", "Enter a valid email address");
  if (spec.contactPhone && !/^\d{10}$/.test(spec.contactPhone)) add("contactPhone", "Phone must be 10 digits");
  if (spec.turnoverInr !== undefined && (!Number.isFinite(spec.turnoverInr) || spec.turnoverInr < 0)) add("turnoverInr", "Turnover cannot be negative");
  if (spec.assigneeId && spec.reviewerId && spec.assigneeId === spec.reviewerId) add("reviewerId", "The reviewer must be a different person from the assignee");
  return issues;
}

// ---------------------------------------------------------------- with lookups

export interface ExistingLmsClient {
  id: string;
  name: string;
  /** Set when the client is already linked to Firm OS. */
  clientCode: string | null;
}

export interface ValidationPorts {
  /** FirmClient with this code (any client), or null. */
  findFirmClientByCode(code: string): Promise<{ lmsClientId: string; legalName: string } | null>;
  /** An LMS Client with this exact name (case-insensitive) or this PAN. */
  findLmsClient(q: { name?: string; pan?: string }): Promise<ExistingLmsClient | null>;
  /** Active, real person (not a shared mailbox). */
  findActiveUser(id: string): Promise<{ id: string; name: string } | null>;
  turia: Pick<TuriaAdapter, "findClientByCode">;
}

export interface ValidationResult {
  errors: Issue[];
  /** Things a person must check by hand (e.g. the Turia lookup under ManualBridge). */
  checks: string[];
  /** An LMS client this onboarding will link to instead of creating a new one. */
  existingLmsClient: ExistingLmsClient | null;
}

export async function validateSpec(spec: PartialSpec, ports: ValidationPorts): Promise<ValidationResult> {
  const errors = validateFields(spec);
  const checks: string[] = [];
  const bad = (f: SpecField) => errors.some((e) => e.field === f);

  let existingLmsClient: ExistingLmsClient | null = null;
  if (spec.legalName || (spec.pan && !bad("pan"))) {
    existingLmsClient = await ports.findLmsClient({ name: spec.legalName, pan: spec.pan && !bad("pan") ? spec.pan : undefined });
    if (existingLmsClient?.clientCode && existingLmsClient.clientCode !== spec.clientCode) {
      errors.push({ field: "legalName", message: `${existingLmsClient.name} is already onboarded to Firm OS as ${existingLmsClient.clientCode}` });
    }
  }

  if (spec.clientCode && !bad("clientCode")) {
    const taken = await ports.findFirmClientByCode(spec.clientCode);
    if (taken && taken.lmsClientId !== existingLmsClient?.id) {
      errors.push({ field: "clientCode", message: `Client code ${spec.clientCode} is already used by ${taken.legalName}` });
    }
    const t = await ports.turia.findClientByCode(spec.clientCode).catch((e: Error) => ({ status: "unknown" as const, reason: causeSentence(e) ?? "Turia could not be checked.", checklistItem: `Check Turia by hand for client code ${spec.clientCode}.` }));
    if (t.status === "found") errors.push({ field: "clientCode", message: `Client code ${spec.clientCode} already exists in Turia (${t.turiaRef})` });
    else if (t.status === "unknown") checks.push(t.checklistItem);
  }

  for (const field of ["assigneeId", "reviewerId"] as const) {
    const id = spec[field];
    if (id && !(await ports.findActiveUser(id))) errors.push({ field, message: `The ${field === "assigneeId" ? "assignee" : "reviewer"} is not an active member of staff. Pick someone else from the list.` });
  }
  return { errors, checks, existingLmsClient };
}

/** First message per field, for the clarifier's `invalid` map. */
export function issuesByField(issues: Issue[]): Partial<Record<SpecField, string>> {
  const out: Partial<Record<SpecField, string>> = {};
  for (const i of issues) out[i.field] ??= i.message;
  return out;
}

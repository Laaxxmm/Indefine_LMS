// Right of access (DPDP Act s.11): everything Firm OS and the LMS client master hold about the
// person, as a JSON file plus a plain-English summary — the categories, purposes, and who the data
// is shared with. Walks inventory.ts, so every inventoried field is in the file, and only rows
// linked to the person the request matched are read (nothing of other people). A person known only
// by identifiers (register.ts resolutionOf "identifier-only") gets the onboarding runs that hold
// exactly those identifiers.
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { fail, ok, type ServiceResult } from "@/lib/corrections/result";
import type { SessionUser } from "@/lib/access";
import { DATASETS, EXTERNAL_SYSTEMS, RESIDUE_DATASETS, SHARED_WITH, nameOnlyRecords, nameOnlySentence, type PrivacyDb, type Row } from "./inventory";
import { PRINCIPAL_LABELS, type PrincipalType } from "./policy";
import { guardRegister, requireResolved, requireVerified, resolutionOf, step, writeAudit, type PrivacyDeps } from "./register";
import { loadScopes } from "./scope";

export interface ExportDataset {
  key: string;
  label: string;
  purpose: string;
  fields: { name: string; label: string }[];
  records: { id: string; values: Record<string, unknown> }[];
}

export interface AccessExport {
  generatedAt: string;
  requestId: string;
  principal: { type: string; typeLabel: string; label: string };
  summary: string[];
  datasets: ExportDataset[];
  sharedWith: readonly string[];
  otherSystems: { label: string; detail: string }[];
  notIncluded: string[];
  /** Records a partner must check by hand before anything is shared (re-audit NEW-8: name-only matches). */
  manualChecks: string[];
}

const NOT_INCLUDED = [
  "Cached inputs of agent runs (sales and purchase registers and similar). They also name the client's customers and suppliers, so the file says only whether a copy is held and when it is purged (at most 30 days after the run).",
  "The names of firm staff who worked on the records.",
  "Files in SharePoint themselves: they are listed by name and link; a partner shares copies on request.",
  "Copies of the person's name or identifiers inside the firm's work records (review comments and notes, checklist findings, computed figures, Turia checklists, reminders, logs). They sit in records about the engagement that also hold staff notes and other people's data; they are erased (replaced with \"[erased]\") when the person's erasure request is carried out.",
];

/** Onboarding runs that never reached a client record: the only data of a person known by identifiers alone. */
const ORPHAN_EXPORT_FIELDS = [
  { name: "prompt", label: "Request as typed" },
  { name: "spec", label: "Details extracted" },
  { name: "status", label: "Status" },
  { name: "createdAt", label: "Started at" },
] as const;

function pickValues(fields: readonly { name: string }[], row: Row, derived?: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.name] = derived && f.name in derived ? derived[f.name] : (row[f.name] ?? null);
  return out;
}

export async function buildAccessExport(db: PrivacyDb, requestId: string, now: Date, hashKey?: string): Promise<AccessExport | null> {
  const request = await db.privacyRequest.findUnique({ where: { id: requestId } });
  if (!request) return null;
  // The one linked person, never every record the identifiers matched (register.ts resolutionOf).
  const resolution = await resolutionOf(db, requestId, hashKey);
  const scopes = resolution.kind === "principal" ? await loadScopes(db, [resolution.principal]) : [];
  const datasets: ExportDataset[] = [];
  if (resolution.kind === "identifier-only") {
    const ds = RESIDUE_DATASETS.find((d) => d.key === "onboarding-orphans")!;
    datasets.push({
      key: ds.key,
      label: ds.label,
      purpose: ds.purpose,
      fields: ORPHAN_EXPORT_FIELDS.map((f) => ({ ...f })),
      records: resolution.rows.map((r) => ({ id: String(r.id), values: pickValues(ORPHAN_EXPORT_FIELDS, r) })),
    });
  }
  for (const scope of scopes) {
    const type: PrincipalType = scope.kind === "staff" ? "staff" : scope.principalType;
    for (const ds of DATASETS.filter((d) => d.principals.includes(type))) {
      const rows = await ds.rows(db, scope);
      const fields = ds.fields.map((f) => ({ name: f.name, label: f.label }));
      const records = rows.map((r) => ({ id: String(r.id), values: pickValues(ds.fields, r, ds.derived?.(r)) }));
      const existing = datasets.find((d) => d.key === ds.key);
      if (existing) existing.records.push(...records);
      else datasets.push({ key: ds.key, label: ds.label, purpose: ds.purpose, fields, records });
    }
  }
  // Re-audit NEW-8: certificates / letters that match the client by typed name only are named, never included.
  const manualChecks: string[] = [];
  for (const scope of scopes) {
    if (scope.kind !== "client") continue;
    const sentence = nameOnlySentence(await nameOnlyRecords(db, scope.client));
    if (sentence) manualChecks.push(sentence);
  }
  const held = datasets.filter((d) => d.records.length > 0);
  const total = held.reduce((n, d) => n + d.records.length, 0);
  const summary = [
    total
      ? `Firm OS and the LMS client master hold ${total} record${total === 1 ? "" : "s"} about this person, in ${held.length} ${held.length === 1 ? "category" : "categories"}.`
      : "Firm OS and the LMS client master hold no records about this person.",
    ...held.map((d) => `${d.label}: ${d.records.length} record${d.records.length === 1 ? "" : "s"} (${d.fields.map((f) => f.label.toLowerCase()).join(", ")}). Why: ${d.purpose}`),
    `Shared with: ${SHARED_WITH.join(" ")}`,
  ];
  const type = (request.principalType in PRINCIPAL_LABELS ? request.principalType : "client-contact") as PrincipalType;
  return {
    generatedAt: `${formatDateTimeIst(now)} IST`,
    requestId,
    principal: { type, typeLabel: PRINCIPAL_LABELS[type], label: request.principalLabel },
    summary,
    datasets,
    sharedWith: SHARED_WITH,
    otherSystems: EXTERNAL_SYSTEMS.filter((s) => s.key !== "audit-log").map((s) => ({ label: s.label, detail: s.detail })),
    notIncluded: NOT_INCLUDED,
    manualChecks,
  };
}

/** The export for download: access requests only, after identity is verified; the download is audited. */
export async function downloadAccessExport(user: SessionUser, id: string, deps: PrivacyDeps): Promise<ServiceResult<{ filename: string; data: AccessExport }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  const checked = await step(deps, async (tx) => {
    const r = await tx.privacyRequest.findUnique({ where: { id }, select: { kind: true } });
    if (!r) return "missing" as const;
    if (r.kind !== "access") return "kind" as const;
    await requireVerified(tx, id);
    await requireResolved(tx, id, deps.hashKey);
    return "ok" as const;
  });
  if (!checked.ok) return checked;
  if (checked.data === "missing") return fail(404, "That privacy request wasn't found. Go back to the register and open it again.");
  if (checked.data === "kind") return fail(409, "Only an access request has an export. Log an access request if the person asks for their data.");
  const data = await buildAccessExport(deps.db, id, deps.now(), deps.hashKey);
  if (!data) return fail(404, "That privacy request wasn't found. Go back to the register and open it again.");
  await writeAudit(deps.db, {
    actorId: user!.id,
    action: "export",
    entity: "PrivacyRequest",
    entityId: id,
    meta: { datasets: data.datasets.filter((d) => d.records.length).length, records: data.datasets.reduce((n, d) => n + d.records.length, 0) },
  });
  return ok({ filename: `privacy-export-${id}.json`, data });
}

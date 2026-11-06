// Right of erasure (DPDP Act s.12) as anonymise-or-hold. Nothing is ever removed:
//
//   for each item of the person's data (inventory.ts):
//     a retention duty still in force (policy.ts)  → legal hold: AuditEvent "legal-hold" with the
//                                                    basis and the hold-until date; data unchanged
//     no duty                                       → anonymise in place with an UPDATE ("[erased]"
//                                                    or empty; row ids and financial figures stay)
//     not personal / purged on a schedule           → kept as it is, with the reason
//     outside Firm OS (Turia, SharePoint)           → a manual step for a partner; Firm OS never
//                                                    deletes there
//
// planErasure() is the preview; confirmErasure() re-plans inside one transaction, refuses if the
// plan changed since it was shown (fingerprint), applies it, and records the outcome per item.
// If anything is held for a client, processing of that client is restricted (consent.ts) so the
// held data is used only for the legal duty.
//
// Two passes per person: DATASETS (their records, one item per row) and RESIDUE_DATASETS (copies of
// their identifiers inside notes, comments, findings, figures and logs: one item per dataset,
// listing the rows; identifiers become "[erased]" in place, scrub.ts). Onboarding runs that never
// reached a client record are found by the person's identifiers. Who the plan is for follows the
// single-principal rule (register.ts resolutionOf): the one linked record, or — when no record
// matched — the onboarding runs that hold exactly the identifiers the request was logged with
// (identifier-only.ts). A parked request (several records matched) or one that matched nothing
// gets an empty plan, and confirmErasure() refuses it.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { formatDate } from "@/lib/agents/core/format";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import { canDecideErasure } from "./access";
import { DATASETS, EXTERNAL_SYSTEMS, RESIDUE_DATASETS, eraseOnboardingRun, scrubberOf, type DataSet, type ModelName, type PrivacyReadDb, type Row } from "./inventory";
import type { DutyId, RequestStatus } from "./policy";
import { guardRegister, loadOpen, requireResolved, requireVerified, resolutionOf, writeAudit, type PrivacyDeps, type Tx } from "./register";
import { restrictInTx } from "./consent";
import { assertErasureDecider } from "./duties";
import { dutiesForScope, loadScopes, type DutyInForce } from "./scope";
import { scrubberFor } from "./scrub";

export type PlanAction = "anonymise" | "hold" | "keep" | "manual";

export interface PlanBasis {
  id: DutyId;
  label: string;
  holdUntil: string | null;
  rule: string;
  verify: string;
}

export interface PlanItem {
  key: string;
  dataset: string;
  label: string;
  model: ModelName | null;
  recordId: string | null;
  /** Columns the UPDATE writes (anonymise) or the data held. */
  fields: string[];
  action: PlanAction;
  basis: PlanBasis[];
  /** Latest dated hold (ISO), or null when open-ended / not held. */
  holdUntil: string | null;
  holdUntilLabel: string | null;
  consequence: string;
  /** Column values the UPDATE writes. Not shown; used by confirmErasure(). */
  set?: Row;
  /** A residue item covers several rows of one table: their ids and (when anonymised) the values written. */
  records?: { id: string; set?: Row }[];
}

export interface ErasurePlan {
  requestId: string;
  items: PlanItem[];
  fingerprint: string;
  counts: Record<PlanAction, number>;
}

const OPEN_ENDED: Partial<Record<DutyId, string>> = {
  "active-engagement": "until the engagement ends",
  "staff-records": "until the person leaves the firm",
};

function holdLabel(basis: DutyInForce[]): { holdUntil: string | null; label: string } {
  const dated = basis.filter((b) => b.holdUntil).map((b) => b.holdUntil!.getTime());
  const max = dated.length ? new Date(Math.max(...dated)) : null;
  const open = basis.filter((b) => !b.holdUntil).map((b) => OPEN_ENDED[b.id] ?? "until a partner lifts it");
  const parts = [...open, ...(max ? [`until ${formatDate(max)}`] : [])];
  const label = parts.join(", and at least ");
  return { holdUntil: max ? max.toISOString() : null, label: label[0].toUpperCase() + label.slice(1) };
}

const toBasis = (d: DutyInForce): PlanBasis => ({ id: d.id, label: d.label, holdUntil: d.holdUntil ? d.holdUntil.toISOString() : null, rule: d.rule, verify: d.verify });

/** Columns an UPDATE writes that are not shown in the export. */
const EXTRA_LABELS: Record<string, string> = {
  folderName: "folder name",
  image: "photo",
  plan: "onboarding plan",
  clientName: "client name",
  inputs: "cached inputs",
  error: "failure details",
  steps: "onboarding steps",
};

const fieldLabels = (key: string, names: string[]) => {
  const ds = [...DATASETS, ...RESIDUE_DATASETS].find((d) => d.key === key);
  return names.map((n) => ds?.fields.find((f) => f.name === n)?.label.toLowerCase() ?? EXTRA_LABELS[n] ?? n).join(", ");
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const ANONYMISE_TAIL = "The record itself stays, so totals and history still add up. This can't be undone.";

function residueItem(ds: DataSet, scopeRef: string, rows: { row: Row; set: Row }[], relevant: DutyInForce[]): PlanItem {
  const key = `${ds.key}:${scopeRef}`;
  const label = `${ds.label} (${plural(rows.length, "record")})`;
  if (relevant.length) {
    const h = holdLabel(relevant);
    return {
      key,
      dataset: ds.key,
      label,
      model: ds.model,
      recordId: null,
      fields: ds.fields.map((f) => f.name),
      action: "hold",
      basis: relevant.map(toBasis),
      holdUntil: h.holdUntil,
      holdUntilLabel: h.label,
      consequence: `Kept under legal hold (${relevant.map((d) => d.label).join("; ")}). The person's names and identifiers in these records stay until the hold ends; then a new erasure request cleans them.`,
      records: rows.map((r) => ({ id: String(r.row.id) })),
    };
  }
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r.set)))];
  const what = fieldLabels(ds.key, fields);
  return {
    key,
    dataset: ds.key,
    label,
    model: ds.model,
    recordId: null,
    fields,
    action: "anonymise",
    basis: [],
    holdUntil: null,
    holdUntilLabel: null,
    consequence: `The person's names and identifiers in the ${what} will be replaced with "[erased]"; everything else in them stays. ${ANONYMISE_TAIL}`,
    records: rows.map((r) => ({ id: String(r.row.id), set: r.set })),
  };
}

export interface PlanOptions {
  /** HMAC key the request's identifiers were hashed with (PrivacyDeps.hashKey; production: AUTH_SECRET). */
  hashKey?: string;
}

export async function planErasure(db: PrivacyReadDb, requestId: string, now: Date, opts: PlanOptions = {}): Promise<ErasurePlan | null> {
  const request = await db.privacyRequest.findUnique({ where: { id: requestId }, select: { id: true } });
  if (!request) return null;
  // The single-principal rule: the one linked person, or the rows of a person known only by identifiers.
  const resolution = await resolutionOf(db, requestId, opts.hashKey);
  const scopes = resolution.kind === "principal" ? await loadScopes(db, [resolution.principal]) : [];
  const items: PlanItem[] = [];
  const planned = new Set<string>(); // "model:id" of rows a residue item already covers

  for (const scope of scopes) {
    const type = scope.kind === "staff" ? "staff" : scope.principalType;
    const duties = await dutiesForScope(db, scope, now);
    const scrub = scrubberOf(scope);
    for (const ds of DATASETS.filter((d) => d.principals.includes(type))) {
      const rows = await ds.rows(db, scope);
      if (!rows.length) continue;
      const rule = ds.erasure;
      if (rule.kind === "keep") {
        items.push({
          key: `${ds.key}:${type}:${String(rows[0].id)}`,
          dataset: ds.key,
          label: `${ds.label} (${rows.length} record${rows.length === 1 ? "" : "s"})`,
          model: ds.model,
          recordId: null,
          fields: ds.fields.map((f) => f.name),
          action: "keep",
          basis: [],
          holdUntil: null,
          holdUntilLabel: null,
          consequence: rule.reason,
        });
        continue;
      }
      for (const row of rows) {
        const id = String(row.id);
        const key = `${ds.key}:${id}`;
        if (rule.kind === "hold") {
          const h = duties.length ? holdLabel(duties) : { holdUntil: null, label: "Kept in SharePoint under the firm's retention" };
          items.push({
            key,
            dataset: ds.key,
            label: ds.label,
            model: ds.model,
            recordId: id,
            fields: ds.fields.map((f) => f.name),
            action: "hold",
            basis: duties.map(toBasis),
            holdUntil: h.holdUntil,
            holdUntilLabel: h.label,
            consequence: rule.reason,
          });
          continue;
        }
        if (rule.applies && !rule.applies(row, scrub)) continue;
        const relevant = rule.duties === "client" ? duties : duties.filter((d) => (rule.duties as readonly DutyId[]).includes(d.id));
        if (relevant.length) {
          const h = holdLabel(relevant);
          items.push({
            key,
            dataset: ds.key,
            label: ds.label,
            model: ds.model,
            recordId: id,
            fields: ds.fields.map((f) => f.name),
            action: "hold",
            basis: relevant.map(toBasis),
            holdUntil: h.holdUntil,
            holdUntilLabel: h.label,
            consequence: `Kept under legal hold (${relevant.map((d) => d.label).join("; ")}). Nothing is changed; the hold is recorded with its basis and date, and processing is restricted to the legal duty.`,
          });
          continue;
        }
        const set = rule.set(row, scrub);
        const fields = Object.keys(set);
        const what = fieldLabels(ds.key, fields);
        items.push({
          key,
          dataset: ds.key,
          label: ds.label,
          model: ds.model,
          recordId: id,
          fields,
          action: "anonymise",
          basis: [],
          holdUntil: null,
          holdUntilLabel: null,
          consequence: `${what.charAt(0).toUpperCase()}${what.slice(1)} will be replaced with "[erased]" or left empty. ${ANONYMISE_TAIL}`,
          set,
        });
      }
    }
    // Residue: the person's identifiers copied into notes, findings, figures and logs.
    const scopeRef = scope.kind === "staff" ? String(scope.user.id) : String(scope.client.id);
    for (const ds of RESIDUE_DATASETS.filter((d) => d.principals.includes(type))) {
      const rule = ds.erasure;
      if (rule.kind !== "anonymise") continue;
      // A row two principals of one request share (e.g. one onboarding run) is planned once, by the first.
      const rows = (await ds.rows(db, scope)).filter((r) => !planned.has(`${ds.model}:${String(r.id)}`) && (!rule.applies || rule.applies(r, scrub)));
      if (!rows.length) continue;
      for (const r of rows) planned.add(`${ds.model}:${String(r.id)}`);
      const relevant = rule.duties === "client" ? duties : duties.filter((d) => (rule.duties as readonly DutyId[]).includes(d.id));
      const withSet = rows.map((row) => ({ row, set: relevant.length ? {} : rule.set(row, scrub) })).filter((r) => relevant.length || Object.keys(r.set).length);
      if (withSet.length) items.push(residueItem(ds, scopeRef, withSet, relevant));
    }
    if (scope.kind === "client") {
      for (const sys of EXTERNAL_SYSTEMS) {
        const relevant = sys.key === "audit-log" || (sys.key === "turia" ? !!scope.firmClient?.turiaClientRef : !!(scope.firmClient?.clSiteUrl || scope.client.graphFolderId));
        if (!relevant) continue;
        items.push({
          key: `external:${sys.key}:${String(scope.client.id)}`,
          dataset: sys.key,
          label: sys.label,
          model: null,
          recordId: null,
          fields: [],
          action: sys.key === "audit-log" ? "keep" : "manual",
          basis: [],
          holdUntil: null,
          holdUntilLabel: null,
          consequence: sys.detail,
        });
      }
    }
  }

  // A person known only by identifiers: the onboarding runs that never reached a client record and
  // hold exactly the identifiers the request was logged with (they are not stored again; matched by
  // their keyed hash). No engagement started, so nothing is held.
  if (resolution.kind === "identifier-only") {
    const ds = RESIDUE_DATASETS.find((d) => d.key === "onboarding-orphans")!;
    const none = scrubberFor([]);
    items.push(residueItem(ds, "request", resolution.rows.map((row) => ({ row, set: eraseOnboardingRun(row, none) })), []));
  }

  const counts: Record<PlanAction, number> = { anonymise: 0, hold: 0, keep: 0, manual: 0 };
  for (const i of items) counts[i.action] += 1;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(items.map((i) => [i.key, i.action, i.holdUntil, i.fields, i.records?.map((r) => r.id) ?? null])))
    .digest("hex");
  return { requestId, items, fingerprint, counts };
}

/** The plan without the column values (what the page and the API show). */
export function publicPlan(plan: ErasurePlan): ErasurePlan {
  return {
    ...plan,
    items: plan.items.map((i) => {
      const shown = Object.fromEntries(Object.entries(i).filter(([k]) => k !== "set")) as unknown as PlanItem;
      return i.records ? { ...shown, records: i.records.map((r) => ({ id: r.id })) } : shown;
    }),
  };
}

const ENTITY_OF: Record<string, string> = {
  client: "Client",
  firmClient: "FirmClient",
  jobTask: "JobTask",
  job: "Job",
  engagement: "Engagement",
  commsDraft: "CommsDraft",
  onboardingRun: "OnboardingRun",
  agentRun: "AgentRun",
  deliverable: "Deliverable",
  clientDocument: "ClientDocument",
  certificateIssue: "CertificateIssue",
  engagementLetter: "EngagementLetter",
  user: "User",
  auditEvent: "AuditEvent",
  checklistResult: "ChecklistResult",
  jobTaskEvent: "JobTaskEvent",
  turiaSync: "TuriaSync",
  mistakeLog: "MistakeLog",
  coachEvent: "CoachEvent",
  modelCall: "ModelCall",
  privacyRequest: "PrivacyRequest",
};

type Updater = { update(args: { where: { id: string }; data: Row }): Promise<unknown> };

/** Interactive-transaction limits for confirmErasure (Prisma defaults: wait 2 s, run 5 s). */
const ERASURE_TX = { maxWait: 10_000, timeout: 120_000 } as const;

export interface ErasureOutcome {
  status: RequestStatus;
  counts: Record<PlanAction, number>;
  legalHold: string | null;
}

export async function confirmErasure(user: SessionUser, id: string, input: { fingerprint: string }, deps: PrivacyDeps): Promise<ServiceResult<ErasureOutcome>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  if (!canDecideErasure(user)) return fail(403, "Only a partner or an admin can decide an erasure.");
  if (!input.fingerprint) return fail(400, "Open the erasure plan and review it before confirming.");
  const actorId = user!.id;
  const now = deps.now();
  try {
    const outcome = await deps.db.$transaction(async (tx: Tx) => {
      await loadOpen(tx, id, ["erasure"]);
      await requireVerified(tx, id);
      await requireResolved(tx, id, deps.hashKey); // never "0 items anonymised" for nobody, or an erasure across several people
      await assertErasureDecider(tx, id, user); // separation of duties: not the person who verified
      const plan = await planErasure(tx, id, now, { hashKey: deps.hashKey });
      if (!plan) throw new Refusal(404, "That privacy request wasn't found. Go back to the register and open it again.");
      if (plan.fingerprint !== input.fingerprint) {
        throw new Refusal(409, "The records changed after the plan was shown. Review the new plan and confirm again.");
      }

      const heldClients = new Set<string>();
      for (const item of plan.items) {
        const entity = item.model ? ENTITY_OF[item.model] : "PrivacyRequest";
        if (item.records && item.model) {
          // Residue: one UPDATE per row, audited per row like any other item.
          for (const r of item.records) {
            if (item.action === "anonymise" && r.set && Object.keys(r.set).length) {
              await (tx[item.model] as unknown as Updater).update({ where: { id: r.id }, data: r.set });
              await writeAudit(tx, { actorId, action: "anonymise", entity, entityId: r.id, meta: { fields: Object.keys(r.set), dataset: item.dataset, privacyRequestId: id } });
            } else if (item.action === "hold") {
              await writeAudit(tx, {
                actorId,
                action: "legal-hold",
                entity,
                entityId: r.id,
                meta: { basis: item.basis.map((b) => b.id), holdUntil: item.holdUntil, holdUntilLabel: item.holdUntilLabel, dataset: item.dataset, privacyRequestId: id } as Prisma.InputJsonObject,
              });
            }
          }
          continue;
        }
        if (item.action === "anonymise" && item.model && item.recordId && item.set) {
          await (tx[item.model] as unknown as Updater).update({ where: { id: item.recordId }, data: item.set });
          await writeAudit(tx, { actorId, action: "anonymise", entity, entityId: item.recordId, meta: { fields: item.fields, privacyRequestId: id } });
        } else if (item.action === "hold" && item.recordId) {
          await writeAudit(tx, {
            actorId,
            action: "legal-hold",
            entity,
            entityId: item.recordId,
            meta: { basis: item.basis.map((b) => b.id), holdUntil: item.holdUntil, holdUntilLabel: item.holdUntilLabel, privacyRequestId: id } as Prisma.InputJsonObject,
          });
          if (item.dataset === "client-identity" || item.dataset === "client-contact") heldClients.add(item.recordId);
        } else if (item.action === "manual") {
          await writeAudit(tx, { actorId, action: "erasure-manual-step", entity: "PrivacyRequest", entityId: id, meta: { system: item.dataset } });
        }
      }
      for (const clientId of heldClients) {
        await restrictInTx(tx, { actorId, requestId: id, entity: "Client", entityId: clientId, keys: ["ai-processing", "comms-drafts", "marketing"], why: "erasure-hold" });
      }

      const held = plan.items.filter((i) => i.action === "hold");
      const bases = new Map<string, string>();
      for (const i of held) for (const b of i.basis) bases.set(b.id, `${b.label} ${b.holdUntil ? `until ${formatDate(new Date(b.holdUntil))}` : (OPEN_ENDED[b.id] ?? "")}`.trim());
      if (held.some((i) => !i.basis.length)) bases.set("sharepoint", "SharePoint files kept under the firm's retention");
      const legalHold = held.length ? [...bases.values()].join("; ") : null;
      const status: RequestStatus = held.length ? "ON_HOLD" : "COMPLETED";
      const c = plan.counts;
      const outcomeText = `${c.anonymise} item${c.anonymise === 1 ? "" : "s"} anonymised, ${c.hold} on legal hold, ${c.keep} kept as they are, ${c.manual} manual step${c.manual === 1 ? "" : "s"} outside Firm OS.`;
      await tx.privacyRequest.update({ where: { id }, data: { status, legalHold: legalHold?.slice(0, 2000) ?? null, outcome: outcomeText, handledById: actorId } });
      await writeAudit(tx, {
        actorId,
        action: "erasure-confirmed",
        entity: "PrivacyRequest",
        entityId: id,
        meta: { anonymised: c.anonymise, held: c.hold, kept: c.keep, manual: c.manual, fingerprint: plan.fingerprint },
      });
      return { status, counts: c, legalHold };
      // Re-planning and one UPDATE + audit row per residue row can outlast Prisma's 5 s default.
    }, ERASURE_TX);
    return ok(outcome);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}

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
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { formatDate } from "@/lib/agents/core/format";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import { canDecideErasure } from "./access";
import { DATASETS, EXTERNAL_SYSTEMS, type ModelName, type PrivacyReadDb, type Row } from "./inventory";
import type { DutyId, RequestStatus } from "./policy";
import { guardRegister, loadOpen, principalOf, requireResolved, requireVerified, writeAudit, type PrivacyDeps, type Tx } from "./register";
import { restrictInTx } from "./consent";
import { dutiesForScope, loadScopes, type DutyInForce } from "./scope";

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
const EXTRA_LABELS: Record<string, string> = { folderName: "folder name", image: "photo", plan: "onboarding plan", clientName: "client name", inputs: "cached inputs" };

const fieldLabels = (key: string, names: string[]) => {
  const ds = DATASETS.find((d) => d.key === key);
  return names.map((n) => ds?.fields.find((f) => f.name === n)?.label.toLowerCase() ?? EXTRA_LABELS[n] ?? n).join(", ");
};

export async function planErasure(db: PrivacyReadDb, requestId: string, now: Date): Promise<ErasurePlan | null> {
  const request = await db.privacyRequest.findUnique({ where: { id: requestId }, select: { id: true } });
  if (!request) return null;
  const scopes = await loadScopes(db, await principalOf(db, requestId)); // the one linked person only
  const items: PlanItem[] = [];

  for (const scope of scopes) {
    const type = scope.kind === "staff" ? "staff" : scope.principalType;
    const duties = await dutiesForScope(db, scope, now);
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
        if (rule.applies && !rule.applies(row)) continue;
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
        const set = rule.set(row);
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
          consequence: `${what.charAt(0).toUpperCase()}${what.slice(1)} will be replaced with "[erased]" or left empty. The record itself stays, so totals and history still add up. This can't be undone.`,
          set,
        });
      }
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

  const counts: Record<PlanAction, number> = { anonymise: 0, hold: 0, keep: 0, manual: 0 };
  for (const i of items) counts[i.action] += 1;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(items.map((i) => [i.key, i.action, i.holdUntil, i.fields])))
    .digest("hex");
  return { requestId, items, fingerprint, counts };
}

/** The plan without the column values (what the page and the API show). */
export function publicPlan(plan: ErasurePlan): ErasurePlan {
  return {
    ...plan,
    items: plan.items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== "set")) as unknown as PlanItem),
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
};

type Updater = { update(args: { where: { id: string }; data: Row }): Promise<unknown> };

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
      await requireResolved(tx, id); // never "0 items anonymised" for nobody, or an erasure across several people
      const plan = await planErasure(tx, id, now);
      if (!plan) throw new Refusal(404, "That privacy request wasn't found. Go back to the register and open it again.");
      if (plan.fingerprint !== input.fingerprint) {
        throw new Refusal(409, "The records changed after the plan was shown. Review the new plan and confirm again.");
      }

      const heldClients = new Set<string>();
      for (const item of plan.items) {
        const entity = item.model ? ENTITY_OF[item.model] : "PrivacyRequest";
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
    });
    return ok(outcome);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}

// Right of correction (DPDP Act s.12): a verified correction request routes into the corrections
// service (src/lib/corrections), limited to the client master records of the person the request
// matched. The correction's own audit row carries the request id, and the request's timeline gets
// a masked "correct" entry. Staff details are corrected in Admin → Team & hierarchy.
import type { SessionUser } from "@/lib/access";
import { correctField, type CorrectionDeps, type CorrectionDone } from "@/lib/corrections/service";
import { fail, type ServiceResult } from "@/lib/corrections/result";
import { guardRegister, loadMatches, loadOpen, requireVerified, step, writeAudit, type PrivacyDeps } from "./register";

export const PRIVACY_CORRECTABLE_ENTITIES = ["Client", "FirmClient"] as const;

export interface PrivacyCorrectionInput {
  entity: string;
  id: string;
  field: string;
  newValue: unknown;
  reason: string;
}

export async function correctForRequest(
  user: SessionUser,
  requestId: string,
  input: PrivacyCorrectionInput,
  deps: PrivacyDeps & { corrections: CorrectionDeps },
): Promise<ServiceResult<CorrectionDone>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  const checked = await step(deps, async (tx) => {
    await loadOpen(tx, requestId, ["correction"]);
    await requireVerified(tx, requestId);
    return true;
  });
  if (!checked.ok) return checked;

  const matches = await loadMatches(deps.db, requestId);
  if (matches.some((m) => m.principalType === "staff") && !matches.some((m) => m.principalType !== "staff")) {
    return fail(409, "Staff details are corrected in Admin → Team & hierarchy, not here. Make the change there and then close this request.");
  }
  const clientIds = new Set(matches.filter((m) => m.principalType !== "staff").map((m) => m.ref));
  let belongs = false;
  if (input.entity === "Client") belongs = clientIds.has(input.id);
  else if (input.entity === "FirmClient") {
    const fc = await deps.db.firmClient.findUnique({ where: { id: input.id }, select: { lmsClientId: true } });
    belongs = !!fc && clientIds.has(fc.lmsClientId);
  }
  if (!belongs) return fail(403, "That record isn't one of this person's client records, so it can't be corrected from this request.");

  const r = await correctField(user, { ...input, privacyRequestId: requestId }, deps.corrections);
  if (!r.ok) return r;
  await writeAudit(deps.db, {
    actorId: user!.id,
    action: "correct",
    entity: "PrivacyRequest",
    entityId: requestId,
    meta: { label: r.data.label, before: r.data.before, after: r.data.after, record: `${r.data.entity}:${r.data.id}` },
  });
  return r;
}

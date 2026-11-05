import { withdrawConsent } from "@/lib/privacy/consent";
import { privacyDeps } from "@/lib/privacy/defaults";
import { idZ, parse, signedIn, toJson } from "@/lib/corrections/http";

// Apply a verified consent withdrawal: record processing restrictions for the person (no new AI
// processing, no new drafts, no marketing use; break nudges off for staff) and complete the request.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  return toJson(await withdrawConsent(s.user, id.data, await privacyDeps()));
}

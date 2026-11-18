import { liftRestriction } from "@/lib/privacy/consent";
import { privacyDeps } from "@/lib/privacy/defaults";
import { liftRestrictionZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// "Lift restriction": a partner ends the processing restriction a consent withdrawal or an erasure
// hold recorded, with a written reason. One AuditEvent per record and one on the request; no
// column changes and nothing removed. AI processing and drafting resume for the person.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(liftRestrictionZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await liftRestriction(s.user, id.data, body.data, await privacyDeps()));
}

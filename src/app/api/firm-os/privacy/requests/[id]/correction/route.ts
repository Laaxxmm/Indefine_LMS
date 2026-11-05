import { correctForRequest } from "@/lib/privacy/correction";
import { privacyCorrectionDeps } from "@/lib/privacy/defaults";
import { privacyCorrectionZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// A verified DPDP correction request: correct one allow-listed field of the person's own client
// record through the corrections service (validation, one transaction, masked audit).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(privacyCorrectionZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await correctForRequest(s.user, id.data, body.data, await privacyCorrectionDeps()));
}

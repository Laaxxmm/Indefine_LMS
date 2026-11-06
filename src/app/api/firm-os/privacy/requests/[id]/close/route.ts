import { closeRequest } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { closeZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Close a request with the reply sent to the person (completed), or refuse it with the reason.
// Grievances are answered here; erasure, consent withdrawal and nomination complete through
// their own steps so each outcome is recorded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(closeZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await closeRequest(s.user, id.data, body.data, await privacyDeps()));
}

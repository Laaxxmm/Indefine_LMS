import { verifyIdentity } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { verifyZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Record how the person's identity was checked. Every later step (export, correction, erasure,
// restriction, nomination) needs this first.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(verifyZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await verifyIdentity(s.user, id.data, body.data, await privacyDeps()));
}

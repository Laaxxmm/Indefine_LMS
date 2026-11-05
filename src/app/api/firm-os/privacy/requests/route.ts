import { createRequest } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { createRequestZ } from "@/lib/privacy/http";
import { parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Log a DPDP request (access, correction, erasure, grievance, nomination, consent withdrawal).
// The service finds the person by exact PAN / GSTIN / email / phone and stores only a keyed hash
// and a masked label. Admins and partners only.
export async function POST(req: Request) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const body = parse(createRequestZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await createRequest(s.user, body.data, await privacyDeps()), 201);
}

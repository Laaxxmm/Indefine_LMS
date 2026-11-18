import { recordNomination } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { nominationZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Record the nominee (DPDP Act s.14) on a verified nomination request and complete it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(nominationZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await recordNomination(s.user, id.data, body.data, await privacyDeps()));
}

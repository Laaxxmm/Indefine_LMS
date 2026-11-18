import { z } from "zod";
import { resolvePrincipal } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

const resolveZ = z.object({ ref: z.string().trim().min(1, "Choose one of the records found for this request.").max(64, "Choose one of the records found for this request.") });

// "This request is about this record": when the identifiers matched several records, an admin or
// partner links the request to the one person it is about. Until then nothing can be shared,
// changed or erased from it. Only a record found when the request was logged can be chosen.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(resolveZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await resolvePrincipal(s.user, id.data, body.data, await privacyDeps()));
}

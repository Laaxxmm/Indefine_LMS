import { updateBreach } from "@/lib/privacy/breach";
import { breachDeps } from "@/lib/privacy/defaults";
import { breachActionZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// One step on an incident: containment note, Board told, affected people told, details update,
// or close (only after both notices). Each step is recorded; nothing is removed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(breachActionZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await updateBreach(s.user, id.data, body.data, await breachDeps()));
}

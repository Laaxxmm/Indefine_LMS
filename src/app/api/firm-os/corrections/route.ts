import { correctField, defaultCorrectionDeps } from "@/lib/corrections/service";
import { correctionBodyZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Correct one allow-listed field of a client, job, engagement or comms draft (src/lib/corrections).
// The service checks who may correct it, validates the value, updates the one column and writes the
// "correct" AuditEvent in one transaction. Nothing is ever removed.
export async function POST(req: Request) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const body = parse(correctionBodyZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await correctField(s.user, body.data, await defaultCorrectionDeps()));
}

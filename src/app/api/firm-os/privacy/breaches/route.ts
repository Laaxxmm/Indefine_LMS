import { recordBreach } from "@/lib/privacy/breach";
import { breachDeps } from "@/lib/privacy/defaults";
import { recordBreachZ } from "@/lib/privacy/http";
import { parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// Record a personal data breach. The notification clocks (Board report and affected people) start
// at the time the firm became aware. Admins and partners only; see docs/runbooks/breach.md.
export async function POST(req: Request) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const body = parse(recordBreachZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await recordBreach(s.user, body.data, await breachDeps()), 201);
}

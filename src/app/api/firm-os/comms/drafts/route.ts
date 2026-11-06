import { NextResponse } from "next/server";
import { requireAgentUser } from "@/lib/agents/http";
import { commsDeps } from "@/lib/agents/comms/defaults";
import { createDraft } from "@/lib/agents/comms/service";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";
import { readJsonCapped } from "@/lib/hardening/json-body";

// "Prepare draft": builds a client message draft (template, optional model polish and translation)
// and stores it as a CommsDraft. A draft only — nothing is sent; staff copy it or open it as an
// Outlook draft in their own mailbox. Each draft can call the model, so it is rate limited per
// person (scope "comms-draft", RATE_LIMIT_COMMS_DRAFT).
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const body = jsonBody.value;
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "The draft request could not be read. Reload the page and try again." }, { status: 400 });
  const limited = await enforceRateLimit("comms-draft", g.user.id);
  if (limited) return limited;
  const deps = commsDeps();
  const r = await createDraft(deps.db, g.user, body, { router: deps.router, now: deps.now() });
  return r.ok ? NextResponse.json(r.data, { status: 201 }) : NextResponse.json({ error: r.error }, { status: r.status });
}

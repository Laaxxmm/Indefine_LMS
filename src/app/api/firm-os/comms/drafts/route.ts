import { NextResponse } from "next/server";
import { requireAgentUser } from "@/lib/agents/http";
import { commsDeps } from "@/lib/agents/comms/defaults";
import { createDraft } from "@/lib/agents/comms/service";

// "Prepare draft": builds a client message draft (template, optional model polish and translation)
// and stores it as a CommsDraft. A draft only — nothing is sent; staff copy it or open it as an
// Outlook draft in their own mailbox.
export async function POST(req: Request) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const deps = commsDeps();
  const r = await createDraft(deps.db, g.user, body, { router: deps.router, now: deps.now() });
  return r.ok ? NextResponse.json(r.data, { status: 201 }) : NextResponse.json({ error: r.error }, { status: r.status });
}

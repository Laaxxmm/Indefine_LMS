import { NextResponse } from "next/server";
import { requireAgentUser } from "@/lib/agents/http";
import { commsDeps } from "@/lib/agents/comms/defaults";
import { openInOutlook } from "@/lib/agents/comms/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Open in Outlook draft": creates (or finds) the draft in the person's OWN mailbox through Graph
// POST /me/messages and returns its Outlook link. The person checks it and sends it from Outlook.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const deps = commsDeps();
  const r = await openInOutlook(deps.db, g.user, id, { token: () => deps.mailToken(g.user.id), outlook: deps.outlook });
  if (r.ok) return NextResponse.json(r.data);
  return NextResponse.json({ error: r.error, ...(r.connect ? { connect: r.connect } : {}) }, { status: r.status });
}

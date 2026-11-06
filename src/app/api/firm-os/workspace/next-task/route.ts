import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUseAgents } from "@/lib/agents/access";
import type { FirmDb } from "@/lib/agents/core/runner";
import { moduleOffMessage } from "@/lib/workspace/guard";
import { signedInUser } from "@/lib/workspace/http";
import { getNextTaskView } from "@/lib/workspace/next-task";
import { isModuleEnabled, type WorkspaceDb } from "@/lib/workspace/settings";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

export const dynamic = "force-dynamic";

// The signed-in person's next task as NextTaskView JSON (src/lib/workspace/contract.ts). Read-only:
// it changes nothing. Same visibility as /agents, and only while the Agents module is on.
export async function GET() {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await signedInUser();
  if (g.res) return g.res;
  if (!canUseAgents(g.user)) return NextResponse.json({ error: "Your account can't use the agents. Ask an admin if you need them." }, { status: 403 });
  if (!(await isModuleEnabled(g.user, "agents", prisma as unknown as WorkspaceDb))) return NextResponse.json({ error: moduleOffMessage("agents") }, { status: 403 });
  const view = await getNextTaskView(g.user, { db: prisma as unknown as FirmDb });
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}

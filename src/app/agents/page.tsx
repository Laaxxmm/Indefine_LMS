import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canSeeAllRuns } from "@/lib/agents/access";
import type { FirmDb } from "@/lib/agents/core/runner";
import { listRuns } from "@/lib/agents/views";
import { EmptyState, RunsTable, eyebrow, pageTitle } from "./parts";

export const dynamic = "force-dynamic";

// Run list. Staff see runs of jobs they prepare or review; managers, partners and admins see all.
export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const all = canSeeAllRuns(session.user);
  const runs = await listRuns(prisma as unknown as FirmDb, session.user);

  return (
    <div>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS</p>
        <h1 className={pageTitle}>{all ? "Agent runs" : "My agent runs"}</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Draft packs prepared by task agents for review. A person checks every finding, approves the pack and files it; the app never files or sends anything.
        </p>
      </div>
      {runs.length === 0 ? (
        <EmptyState title="No agent runs yet">{all ? "Runs appear here once an assignee runs an agent on a job." : "Runs on jobs assigned to you, or that you review, appear here."}</EmptyState>
      ) : (
        <RunsTable runs={runs} />
      )}
    </div>
  );
}

import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canSeeAllRuns } from "@/lib/agents/access";
import type { FirmDb } from "@/lib/agents/core/runner";
import { getAgent, visibleAgents } from "@/lib/agents/registry";
import { listRunnableJobs, listRuns } from "@/lib/agents/views";
import { DataTable, EmptyState, PageHeader, Section, StateChip } from "@/components/firm-os";
import { td, tr } from "@/components/ui";
import { AGENTS_LABEL, RunsTable } from "../parts";
import { RunAgentButton } from "./RunAgentButton";

export const dynamic = "force-dynamic";

// One agent: the jobs the person can run it on now (the page's one primary action), then its runs.
export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { agent } = await params;
  const def = getAgent(agent);
  if (!def || !visibleAgents().some((a) => a.key === def.key)) notFound();
  const db = prisma as unknown as FirmDb;
  const [jobs, runs] = await Promise.all([listRunnableJobs(db, session.user, def, new Date()), listRuns(db, session.user, { agent: def.key })]);

  return (
    <div>
      <PageHeader back={{ href: "/agents", label: AGENTS_LABEL }} eyebrow={`Agent · ${def.service}`} title={def.title} />

      <Section id="ready" title="Jobs ready for the agent">
        {jobs.length === 0 ? (
          <EmptyState title="Nothing to run">
            {canSeeAllRuns(session.user)
              ? `${def.service} jobs appear here when they are ASSIGNED or IN_PREP.`
              : `${def.service} jobs assigned to you appear here when they are ASSIGNED or IN_PREP.`}
          </EmptyState>
        ) : (
          <DataTable
            caption="Jobs the agent can prepare now"
            columns={[{ label: "Job" }, { label: "Client" }, { label: "Period" }, { label: "Job state" }, { label: "Internal due" }, { label: "Action", align: "right", srOnly: true }]}
          >
            {jobs.map((j) => (
              <tr key={j.id} className={tr}>
                <td className={`${td} font-semibold`}>{j.title}</td>
                <td className={td}>{j.clientCode}</td>
                <td className={`${td} tabular-nums`}>
                  {j.period} · FY {j.fy}
                </td>
                <td className={td}>
                  <StateChip state={j.state} />
                </td>
                <td className={`${td} tabular-nums`}>{j.internalDue}</td>
                <td className={`${td} text-right`}>
                  <RunAgentButton agent={def.key} jobId={j.id} label={`Run agent on ${j.title} for ${j.clientCode}`} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section id="runs" title="Runs" last>
        {runs.length === 0 ? <EmptyState title="No runs yet" /> : <RunsTable runs={runs} showAgent={false} />}
      </Section>
    </div>
  );
}

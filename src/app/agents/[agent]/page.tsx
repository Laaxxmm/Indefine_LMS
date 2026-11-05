import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { FirmDb } from "@/lib/agents/core/runner";
import { getAgent, visibleAgents } from "@/lib/agents/registry";
import { listRunnableJobs, listRuns } from "@/lib/agents/views";

import { EmptyState, RunsTable, StateChip, eyebrow, focusRing, pageTitle, tableWrap, td, th, thead, sectionTitle } from "../parts";
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
      <Link href="/agents" className={`inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4 rounded ${focusRing}`}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Runs
      </Link>
      <div className="mb-6">
        <p className={eyebrow}>Agent · {def.service}</p>
        <h1 className={pageTitle}>{def.title}</h1>
      </div>

      <section aria-labelledby="ready" className="mb-8">
        <h2 id="ready" className={sectionTitle}>
          Jobs ready for the agent
        </h2>
        {jobs.length === 0 ? (
          <EmptyState title="Nothing to run">{`${def.service} jobs assigned to you appear here when they are ASSIGNED or IN PREP.`}</EmptyState>
        ) : (
          <div className={tableWrap}>
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Jobs the agent can prepare now</caption>
              <thead className={thead}>
                <tr>
                  <th scope="col" className={th}>Job</th>
                  <th scope="col" className={th}>Client</th>
                  <th scope="col" className={th}>Period</th>
                  <th scope="col" className={th}>Job state</th>
                  <th scope="col" className={th}>Internal due</th>
                  <th scope="col" className={`${th} text-right`}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border hover:bg-muted/40 h-11">
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
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="runs">
        <h2 id="runs" className={sectionTitle}>
          Runs
        </h2>
        {runs.length === 0 ? <EmptyState title="No runs yet" /> : <RunsTable runs={runs} showAgent={false} />}
      </section>
    </div>
  );
}

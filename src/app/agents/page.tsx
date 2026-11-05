import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { btnGhost } from "@/components/ui";
import { canSeeAllRuns } from "@/lib/agents/access";
import type { FirmDb } from "@/lib/agents/core/runner";
import { visibleAgents } from "@/lib/agents/registry";
import { listMyJobs, listRuns, type MyJobRow } from "@/lib/agents/views";
import { RunAgentButton } from "./[agent]/RunAgentButton";
import { EmptyState, RunsTable, StateChip, eyebrow, focusRing, pageTitle, runsListLabel, sectionTitle, tableWrap, td, th, thead } from "./parts";

export const dynamic = "force-dynamic";

function JobAction({ job }: { job: MyJobRow }) {
  const a = job.action;
  if (a.kind === "run") return <RunAgentButton agent={a.agent} jobId={job.id} label={`Run agent on ${job.title} for ${job.clientCode}`} />;
  if (a.kind === "open")
    return (
      <Link href={`/agents/${a.agent}/runs/${a.runId}`} className={`${btnGhost} ${focusRing} inline-flex whitespace-nowrap`} aria-label={`${a.label}: ${job.title} for ${job.clientCode}`}>
        {a.label}
      </Link>
    );
  return <span className="text-[12px] text-ink-mute">No agent for {job.service} yet</span>;
}

function MyJobsTable({ jobs }: { jobs: MyJobRow[] }) {
  return (
    <div className={tableWrap}>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Jobs waiting for you, soonest internal due first</caption>
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Period</th>
            <th scope="col" className={th}>Job state</th>
            <th scope="col" className={th}>Internal due</th>
            <th scope="col" className={th}>Your part</th>
            <th scope="col" className={`${th} text-right`}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-border hover:bg-muted/40 h-11">
              <td className={`${td} font-semibold`}>
                {j.title}
                <span className="ml-2 text-[11.5px] text-ink-mute font-normal">{j.service}</span>
              </td>
              <td className={td}>
                <span className="font-semibold">{j.clientCode}</span>
                {j.clientName && <span className="block text-[11.5px] text-ink-mute">{j.clientName}</span>}
              </td>
              <td className={`${td} tabular-nums whitespace-nowrap`}>
                {j.period} · FY {j.fy}
              </td>
              <td className={td}>
                <StateChip state={j.state} />
              </td>
              <td className={`${td} tabular-nums whitespace-nowrap`}>{j.internalDue}</td>
              <td className={`${td} whitespace-nowrap`}>{j.part}</td>
              <td className={`${td} text-right`}>
                <JobAction job={j} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The Firm OS work queue and run list. "Waiting for you": jobs the person prepares or reviews on
// which they can act now (run the agent, submit the pack, review it). Then the runs: staff see runs
// of jobs they prepare or review; managers, partners and admins see all.
export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const all = canSeeAllRuns(session.user);
  const db = prisma as unknown as FirmDb;
  const [jobs, runs] = await Promise.all([listMyJobs(db, session.user, visibleAgents(), new Date()), listRuns(db, session.user)]);

  return (
    <div>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS</p>
        <h1 className={pageTitle}>{runsListLabel(all)}</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Draft packs prepared by task agents for review. A person checks every finding, approves the pack and files it; the app never files or sends anything.
        </p>
      </div>

      <section aria-labelledby="waiting" className="mb-8">
        <h2 id="waiting" className={sectionTitle}>
          Waiting for you
        </h2>
        {jobs.length === 0 ? (
          <EmptyState title="Nothing waiting for you">Jobs you prepare appear here when they are ready for the agent; packs you review appear when they are submitted.</EmptyState>
        ) : (
          <MyJobsTable jobs={jobs} />
        )}
      </section>

      <section aria-labelledby="runs">
        <h2 id="runs" className={sectionTitle}>
          {all ? "All runs" : "Runs on your jobs"}
        </h2>
        {runs.length === 0 ? (
          <EmptyState title="No agent runs yet">{all ? "Runs appear here once an assignee runs an agent on a job." : "Runs on jobs assigned to you, or that you review, appear here."}</EmptyState>
        ) : (
          <RunsTable runs={runs} />
        )}
      </section>
    </div>
  );
}

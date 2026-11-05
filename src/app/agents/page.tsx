import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buttonClass, DataTable, EmptyState, PageHeader, Section, StateChip } from "@/components/firm-os";
import { td, tr } from "@/components/ui";
import { canSeeAllRuns } from "@/lib/agents/access";
import type { FirmDb } from "@/lib/agents/core/runner";
import { visibleAgents } from "@/lib/agents/registry";
import { listMyJobs, listRuns, type MyJobRow } from "@/lib/agents/views";
import { RunAgentButton } from "./[agent]/RunAgentButton";
import { RunsTable, runsListLabel } from "./parts";

export const dynamic = "force-dynamic";

function JobAction({ job }: { job: MyJobRow }) {
  const a = job.action;
  if (a.kind === "run") return <RunAgentButton agent={a.agent} jobId={job.id} label={`Run agent on ${job.title} for ${job.clientCode}`} />;
  if (a.kind === "open")
    return (
      <Link href={`/agents/${a.agent}/runs/${a.runId}`} className={buttonClass("secondary", "md", "whitespace-nowrap")} aria-label={`${a.label}: ${job.title} for ${job.clientCode}`}>
        {a.label}
      </Link>
    );
  return <span className="text-[12px] text-ink-mute">No agent for {job.service} yet</span>;
}

function MyJobsTable({ jobs }: { jobs: MyJobRow[] }) {
  return (
    <DataTable
      caption="Jobs waiting for you, soonest internal due first"
      columns={[{ label: "Job" }, { label: "Client" }, { label: "Period" }, { label: "Job state" }, { label: "Internal due" }, { label: "Your part" }, { label: "Action", align: "right", srOnly: true }]}
    >
      {jobs.map((j) => (
        <tr key={j.id} className={tr}>
          <td className={`${td} font-semibold min-w-[12rem]`}>
            {j.title}
            <span className="ml-2 text-[12px] text-ink-mute font-normal">{j.service}</span>
          </td>
          <td className={td}>
            <span className="font-semibold">{j.clientCode}</span>
            {j.clientName && <span className="block text-[12px] text-ink-mute">{j.clientName}</span>}
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
    </DataTable>
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
      <PageHeader
        eyebrow="Firm OS"
        title={runsListLabel(all)}
        lead="Draft packs prepared by task agents for review. A person checks every finding, approves the pack and files it; the app never files or sends anything."
      />

      <Section id="waiting" title="Waiting for you">
        {jobs.length === 0 ? (
          <EmptyState title="Nothing waiting for you">Jobs you prepare appear here when they are ready for the agent; packs you review appear when they are submitted.</EmptyState>
        ) : (
          <MyJobsTable jobs={jobs} />
        )}
      </Section>

      <Section id="runs" title={<>{all ? "All runs" : "Runs on your jobs"}</>} last>
        {runs.length === 0 ? (
          <EmptyState title="No agent runs yet">{all ? "Runs appear here once an assignee runs an agent on a job." : "Runs on jobs assigned to you, or that you review, appear here."}</EmptyState>
        ) : (
          <RunsTable runs={runs} />
        )}
      </Section>
    </div>
  );
}

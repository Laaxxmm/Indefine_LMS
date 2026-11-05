import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { btnGhost, card } from "@/components/ui";
import { EmptyState, StateChip, eyebrow, focusRing, pageTitle, sectionTitle } from "@/app/agents/parts";
import type { FirmDb } from "@/lib/agents/core/runner";
import { getNextTaskView } from "@/lib/workspace/next-task";
import { NextActionButton } from "@/app/workspace/NextActionButton";
import { ChecklistList, DueLine, OpenQuestionsList, PortalNote, SopStepsList } from "@/app/workspace/parts";

export const dynamic = "force-dynamic";

// Focus mode: only the next task — what it is, why it is next, the SOP steps, what must be true
// before moving on, and the one primary action (it opens the existing screen where the work is
// done). "Done? Show next task" asks again; if the same job is still first, the page says so.
// Nothing here files, submits or sends anything.
export default async function FocusPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { after } = await searchParams;
  const view = await getNextTaskView(session.user, { db: prisma as unknown as FirmDb });
  const task = view.task;

  if (!task) {
    return (
      <div>
        <p className={eyebrow}>Focus</p>
        <h1 className={`${pageTitle} mb-6`}>Everything is up to date</h1>
        <EmptyState title="Nothing is waiting for you right now">New work appears here when a job is assigned to you or a pack is sent to you for review.</EmptyState>
        <p className="mt-6 text-center">
          <Link href="/focus" className={`${btnGhost} ${focusRing} inline-flex`}>
            Check again
          </Link>
        </p>
      </div>
    );
  }

  const { job, action } = task;
  const context = `${job.title} for ${job.clientCode}`;
  return (
    <div className="space-y-6">
      <div>
        <p className={eyebrow}>Your next task</p>
        <h1 className={pageTitle}>{job.title}</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">
          {job.clientName ? `${job.clientName} (${job.clientCode})` : job.clientCode} · {job.service} · <span className="tabular-nums">{job.period} · FY {job.fy}</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <StateChip state={task.state} />
          <span className="text-[12px] text-ink-mute">You are the {job.part.toLowerCase()}</span>
        </div>
      </div>

      {after === job.id && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px]">
          This task still needs you: the job is {task.state}, and the next step is {action.label}.
        </p>
      )}

      <section aria-labelledby="why" className={card}>
        <h2 id="why" className={sectionTitle}>
          Why this is next
        </h2>
        <p className="text-[15px] leading-relaxed">{task.why}</p>
        <div className="mt-2">
          <DueLine internalDue={job.internalDue} statutoryDue={job.statutoryDue} overdue={job.overdue} />
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <NextActionButton action={action} jobId={job.id} context={context} />
          <Link href={task.href} className={`${btnGhost} ${focusRing}`}>
            Open the guided workspace
          </Link>
        </div>
      </section>

      {task.portalNote && <PortalNote note={task.portalNote} />}

      <section aria-labelledby="steps" className={card}>
        <SopStepsList steps={task.sopSteps} headingId="steps" />
      </section>

      <section aria-labelledby="before" className={card}>
        <ChecklistList items={task.checklist} headingId="before" />
      </section>

      {task.openQuestions.length > 0 && (
        <section aria-labelledby="questions" className={card}>
          <OpenQuestionsList questions={task.openQuestions} headingId="questions" />
        </section>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
        <p className="text-[13px] text-ink-mute">{view.remaining === 0 ? "Nothing else is waiting after this one." : `${view.remaining} more waiting after this one.`}</p>
        <Link href={`/focus?after=${encodeURIComponent(job.id)}`} className={`${btnGhost} ${focusRing}`}>
          Done? Show next task
        </Link>
      </div>
    </div>
  );
}

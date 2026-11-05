import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, Info, XCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { FirmDb } from "@/lib/agents/core/runner";
import { loadRunReview, type ChecklistView } from "@/lib/agents/views";
import { loadCloseLoopView, type CloseLoopViewDb } from "@/lib/close-loop/review";
import { card } from "@/components/ui";
import { BackLink, PartnerChip, RunStatusChip, StateChip, eyebrow, focusRing, pageTitle, sectionTitle } from "../../../parts";
import { ActionBar, CloseLoopStatus, CommentsPanel, DeliverablesPanel, MistakeForm } from "./ReviewPanels";

export const dynamic = "force-dynamic";

// Agent pack review (DESIGN): left = checklist results with evidence, right = deliverables with
// preview, comments; bottom bar = the one action the person can take now ("Approve pack",
// "Request changes", "Submit for review" with "Re-run with a note" beside it, "Run agent"; after
// approval "Mark filed", then "Record Turia close"). The person files on the portal; there is no
// portal, submit or send action here.

type Tone = { label: string; box: string; icon: typeof XCircle; iconClass: string };

function tone(c: ChecklistView): Tone {
  if (c.status === "fail" && c.severity === "block") return { label: "Block", box: "border-l-rose-600 bg-rose-50/60", icon: XCircle, iconClass: "text-rose-700" };
  if (c.status === "fail" && c.severity === "warn") return { label: "Warning", box: "border-l-amber-500 bg-amber-50/60", icon: AlertTriangle, iconClass: "text-amber-800" };
  if (c.status === "fail") return { label: "Note", box: "border-l-sky-500 bg-sky-50/60", icon: Info, iconClass: "text-sky-800" };
  if (c.status === "na") return { label: "Check by hand", box: "border-l-ink-mute bg-muted/60", icon: CircleHelp, iconClass: "text-ink-soft" };
  return { label: "Passed", box: "border-l-emerald-600 bg-card", icon: CheckCircle2, iconClass: "text-emerald-700" };
}

const SOURCE: Record<string, string> = { deterministic: "rule", llm: "model check", mistake: "learned rule" };

export default async function RunReviewPage({ params }: { params: Promise<{ agent: string; id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { agent, id } = await params;
  const review = await loadRunReview(prisma as unknown as FirmDb, session.user, id, new Date());
  if (!review || review.run.agent !== agent) notFound();
  const { run, job, counts, actions } = review;
  const closeLoop = await loadCloseLoopView(prisma as unknown as CloseLoopViewDb, session.user, job.id, { isLatest: review.isLatest });

  const authorIds = [...new Set(review.comments.map((c) => c.author))];
  const users = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const comments = review.comments.map((c) => ({ ...c, author: nameOf.get(c.author) ?? c.author }));

  return (
    <div>
      <BackLink href={`/agents/${agent}`}>{run.agentTitle}</BackLink>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <p className={eyebrow}>
            Agent run · attempt {run.attempt} · SOP pack v{run.sopPackVersion}
          </p>
          <h1 className={pageTitle}>
            {job.title} — {job.clientName} ({job.clientCode})
          </h1>
          <p className="text-ink-mute text-[13.5px] mt-1.5 tabular-nums">
            {job.service} · {job.period} · FY {job.fy} · started {run.startedAt} · finished {run.finishedAt}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StateChip state={job.state} />
          <RunStatusChip status={run.status} />
          {run.needsPartnerReview && <PartnerChip />}
        </div>
      </div>

      {!review.isLatest && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px] mb-4" role="status">
          A newer run exists for this job. This run is kept for the record; act on the latest one.
        </p>
      )}
      {run.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px] mb-4" role="alert">
          <p className="font-bold">The agent could not finish this run</p>
          <p className="mt-0.5">{run.error}</p>
        </div>
      )}
      {run.reviewNotes && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] mb-4">
          {/* From "Request changes" (the reviewer) or "Re-run with a note" (the preparer, a manager or a partner). */}
          <span className="font-bold">Notes for this run: </span>
          {run.reviewNotes}
        </p>
      )}

      {review.figures.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {review.figures.map((f) => (
            <div key={f.key} className={card}>
              <dt className={sectionTitle}>{f.label}</dt>
              <dd className="font-display text-[22px] font-extrabold tabular-nums leading-none">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <section aria-labelledby="checklist" className={card}>
          <h2 id="checklist" className={sectionTitle}>
            Checklist
          </h2>
          <p className="text-[13px] text-ink-soft mb-4 tabular-nums">
            <span className={counts.block ? "text-rose-700 font-bold" : ""}>{counts.block} block</span> · <span className={counts.warn ? "text-amber-800 font-bold" : ""}>{counts.warn} warning</span> · {counts.info} note ·{" "}
            {counts.na} to check by hand · {counts.pass} passed
          </p>
          {review.checklist.length === 0 ? (
            <p className="text-[13px] text-ink-mute">No checklist results{run.status === "FAILED" ? " — the run failed before the checks." : "."}</p>
          ) : (
            <ul className="space-y-2.5">
              {review.checklist.map((c) => {
                const t = tone(c);
                const Icon = t.icon;
                return (
                  <li key={c.id} className={`rounded-lg border border-border border-l-4 ${t.box} px-3.5 py-2.5`}>
                    <div className="flex items-start gap-2.5">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${t.iconClass}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold">
                          <span className={`${t.iconClass} font-bold`}>{t.label}:</span> {c.message}
                        </p>
                        <p className="text-[11.5px] text-ink-mute mt-0.5">
                          {c.ruleId} · {c.severity} · {SOURCE[c.source] ?? c.source}
                          {c.flags.length > 0 && ` · ${c.flags.join(", ")}`}
                        </p>
                        {(c.quote || c.location) && (
                          <figure className="mt-1.5">
                            {c.quote && <blockquote className="text-[12.5px] font-mono bg-card border border-border rounded px-2 py-1 break-words">“{c.quote}”</blockquote>}
                            {c.location && (
                              <figcaption className="text-[11.5px] text-ink-mute mt-0.5">
                                {c.link ? (
                                  <a href={c.link} target="_blank" rel="noopener noreferrer" className={`text-brand-600 hover:underline rounded ${focusRing}`}>
                                    {c.location}
                                  </a>
                                ) : (
                                  c.location
                                )}
                              </figcaption>
                            )}
                          </figure>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {closeLoop && <CloseLoopStatus view={closeLoop} />}
          <DeliverablesPanel deliverables={review.deliverables} />
          <CommentsPanel runId={run.id} comments={comments} />
          {actions.proposeMistake && <MistakeForm runId={run.id} checks={review.checks} />}
        </div>
      </div>

      <ActionBar agent={agent} runId={run.id} jobId={job.id} jobState={job.state} actions={actions} blockFails={counts.block} deliverables={review.deliverables.filter((d) => d.kind === "Working").length} closeLoop={closeLoop} />
    </div>
  );
}

import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleHelp, Info, XCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { FirmDb } from "@/lib/agents/core/runner";
import { loadRunReview, type ChecklistView, type OpenQuestionView } from "@/lib/agents/views";
import { loadCloseLoopView, type CloseLoopViewDb } from "@/lib/close-loop/review";
import { card, figure, focusRing, linkText, sectionTitle } from "@/components/ui";
import { HistoryLink } from "@/components/CorrectionHistory";
import { Alert, PageHeader, PartnerChip, RunStatusChip, Section, StateChip } from "@/components/firm-os";
import { ActionBar, CloseLoopStatus, CommentsPanel, DeliverablesPanel, MistakeForm } from "./ReviewPanels";

export const dynamic = "force-dynamic";

// Agent pack review (DESIGN): left = checklist results with evidence, right = open questions (when
// any: abstentions / client document requests first, with any amount held back), deliverables with
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

// Open questions (ADR-008): what the model could not answer from the documents (a document or
// confirmation for staff to ask the client for), two model reads that disagreed, or a rule outside
// the agent's scope. Same item look as the checklist; nothing here contacts the client.
function questionTone(q: OpenQuestionView): Omit<Tone, "icon"> {
  if (q.clientRequest) return { label: "Client document request", box: "border-l-sky-500 bg-sky-50/60", iconClass: "text-sky-800" };
  return { label: q.kind === "model-disagreement" ? "Reviewer decides" : "Check by hand", box: "border-l-ink-mute bg-muted/60", iconClass: "text-ink-soft" };
}

const QUESTION_KIND: Record<OpenQuestionView["kind"], string> = {
  "insufficient-evidence": "the documents do not show the answer",
  "possible-prompt-injection": "document text reads like an instruction to the AI and was not sent to it",
  "model-disagreement": "two model reads disagree",
  "out-of-scope": "not one of this agent's checks",
};

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
      <PageHeader
        back={{ href: `/agents/${agent}`, label: run.agentTitle }}
        eyebrow={<>Agent run · attempt {run.attempt} · SOP pack v{run.sopPackVersion}</>}
        title={<>{job.title} — {job.clientName} ({job.clientCode})</>}
        meta={<>{job.service} · {job.period} · FY {job.fy} · started {run.startedAt} · finished {run.finishedAt}</>}
        action={
          <>
            <StateChip state={job.state} />
            <RunStatusChip status={run.status} />
            {run.needsPartnerReview && <PartnerChip />}
          </>
        }
      />

      {/* The job's correction history (who changed which field, when and why, and a fix for a wrong entry), and a client message from this run. */}
      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <HistoryLink entity="JobTask" id={job.id} />
        <Link href={`/comms/new?run=${run.id}`} className={`text-[13px] ${linkText}`}>
          Draft client message
        </Link>
      </div>

      {!review.isLatest && (
        <Alert tone="warning" className="mb-4">
          A newer run exists for this job. This run is kept for the record; act on the latest one.
        </Alert>
      )}
      {run.error && (
        <Alert tone="error" title="The agent could not finish this run" className="mb-4">
          {run.error}
        </Alert>
      )}
      {run.reviewNotes && (
        // From "Request changes" (the reviewer) or "Re-run with a note" (the preparer, a manager or a partner).
        <Alert tone="info" role="note" className="mb-4">
          <span className="font-bold">Notes for this run: </span>
          {run.reviewNotes}
        </Alert>
      )}

      {review.figures.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {review.figures.map((f) => (
            <div key={f.key} className={card}>
              <dt className={sectionTitle}>{f.label}</dt>
              <dd className={figure}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Section id="checklist" title="Checklist" card last>
          <p className="text-[13px] text-ink-soft mb-4 tabular-nums">
            <span className={counts.block ? "text-rose-700 font-bold" : ""}>{counts.block} block</span> · <span className={counts.warn ? "text-amber-800 font-bold" : ""}>{counts.warn} warning</span> · {counts.info} note ·{" "}
            {counts.na} to check by hand · {counts.pass} passed
          </p>
          {review.checklist.length === 0 ? (
            <p className="text-[13px] text-ink-mute">No checklist results{run.status === "FAILED" ? " — the run failed before the checks." : "."}</p>
          ) : (
            <ul className="space-y-3">
              {review.checklist.map((c) => {
                const t = tone(c);
                const Icon = t.icon;
                return (
                  <li key={c.id} className={`rounded-lg border border-border border-l-4 ${t.box} px-4 py-3`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${t.iconClass}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">
                          <span className={`${t.iconClass} font-bold`}>{t.label}:</span> {c.message}
                        </p>
                        <p className="text-[12px] text-ink-mute mt-1">
                          {c.ruleId} · {c.severity} · {SOURCE[c.source] ?? c.source}
                          {c.flags.length > 0 && ` · ${c.flags.join(", ")}`}
                        </p>
                        {(c.quote || c.location) && (
                          <figure className="mt-2">
                            {c.quote && <blockquote className="text-[12px] font-mono bg-card border border-border rounded px-2 py-1 break-words">“{c.quote}”</blockquote>}
                            {c.location && (
                              <figcaption className="text-[12px] text-ink-mute mt-1">
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
        </Section>

        <div className="space-y-6">
          {review.openQuestions.length > 0 && (
            <Section id="open-questions" title="Open questions" card last>
              <p className="text-[13px] text-ink-soft mb-4">
                {review.openQuestions.length} question{review.openQuestions.length === 1 ? "" : "s"} for the reviewer: what the documents did not show, model reads that disagreed, or rules outside
                this agent&apos;s checks. Approval does not wait on them, so settle each first; a client document request is for staff to raise with the client — Firm OS does not contact the client.
              </p>
              <ul className="space-y-3">
                {review.openQuestions.map((q) => {
                  const t = questionTone(q);
                  return (
                    <li key={q.id} className={`rounded-lg border border-border border-l-4 ${t.box} px-4 py-3`}>
                      <div className="flex items-start gap-3">
                        <CircleHelp className={`w-4 h-4 mt-0.5 shrink-0 ${t.iconClass}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold">
                            <span className={`${t.iconClass} font-bold`}>{t.label}:</span> {q.question}
                          </p>
                          <p className="text-[12px] text-ink-mute mt-1">
                            {q.ruleId} · {QUESTION_KIND[q.kind]}
                          </p>
                          {(q.quote || q.location) && (
                            <figure className="mt-2">
                              {q.quote && <blockquote className="text-[12px] font-mono bg-card border border-border rounded px-2 py-1 break-words">“{q.quote}”</blockquote>}
                              {q.location && (
                                <figcaption className="text-[12px] text-ink-mute mt-1">
                                  {q.link ? (
                                    <a href={q.link} target="_blank" rel="noopener noreferrer" className={`text-brand-600 hover:underline rounded ${focusRing}`}>
                                      {q.location}
                                    </a>
                                  ) : (
                                    q.location
                                  )}
                                </figcaption>
                              )}
                            </figure>
                          )}
                          {q.heldBack && (
                            <p className="text-[13px] mt-2 tabular-nums">
                              <span className="text-ink-mute">{q.heldBack.label}: </span>
                              <span className="font-bold">{q.heldBack.amount}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
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

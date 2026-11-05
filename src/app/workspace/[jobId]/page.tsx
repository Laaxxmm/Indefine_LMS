import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { card } from "@/components/ui";
import { BackLink, RunStatusChip, StateChip, chip, eyebrow, linkText, pageTitle, sectionTitle } from "@/app/agents/parts";
import { DeliverablesPanel } from "@/app/agents/[agent]/runs/[id]/ReviewPanels";
import { DOC_TYPES } from "@/lib/clients/core";
import { loadWorkspaceView, type WorkspaceView, type WorkspaceViewDb } from "@/lib/workspace/view";
import { NextActionButton } from "../NextActionButton";
import { WorkspaceTabs } from "../WorkspaceTabs";
import { ChecklistList, DueLine, OpenQuestionsList, PortalNote, SopStepsList } from "../parts";

export const dynamic = "force-dynamic";

// Guided workspace: left, a sticky panel with the job, its SOP steps (current step marked), what
// must be true before moving on, open questions and the one next action; right, a tabbed viewer —
// the latest run's deliverables (previewed through the existing preview route), the client's
// documents (SharePoint links open in a new tab) and the SOP pack text. On a phone the panel stacks
// above the viewer. Government portals are never embedded or linked: a person files in their own
// browser, with this page beside it.

const SEV_TONE = { block: "border-rose-200 bg-rose-50 text-rose-700", warn: "border-amber-200 bg-amber-50 text-amber-800", info: "border-sky-200 bg-sky-50 text-sky-800" } as const;
const SEV_LABEL = { block: "Block", warn: "Warning", info: "Note" } as const;
const newTab = { target: "_blank", rel: "noopener noreferrer" } as const;

function ClientDocsPanel({ docs }: { docs: WorkspaceView["clientDocs"] }) {
  return (
    <section aria-labelledby="client-docs" className={card}>
      <h2 id="client-docs" className={sectionTitle}>
        Client documents
      </h2>
      {docs.folderUrl && (
        <p className="mb-4">
          <a href={docs.folderUrl} {...newTab} className={`${linkText} inline-flex items-center gap-1.5 text-[13.5px]`}>
            <ExternalLink className="w-4 h-4" aria-hidden="true" /> Open this period&apos;s ClientDocs folder in SharePoint
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      {docs.files.length === 0 ? (
        <p className="text-[13px] text-ink-mute">No documents are recorded for this client yet. Put this period&apos;s documents in the ClientDocs folder; the agent reads them from there.</p>
      ) : (
        <ul className="divide-y divide-border">
          {docs.files.map((d) => (
            <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <a href={d.webUrl} {...newTab} className={`${linkText} text-[13.5px] break-all`}>
                  {d.name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <p className="text-[11.5px] text-ink-mute tabular-nums">
                  {DOC_TYPES[d.docType] ?? d.docType} · added {d.uploaded}
                  {d.forThisJob ? " · this job" : ""}
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-ink-mute shrink-0" aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SopPackPanel({ pack, service }: { pack: WorkspaceView["sopPack"]; service: string }) {
  if (!pack) {
    return (
      <section aria-labelledby="sop-pack" className={card}>
        <h2 id="sop-pack" className={sectionTitle}>
          SOP pack
        </h2>
        <p className="text-[13px] text-ink-mute">No SOP pack for {service} yet: there is no agent for this service, so there are no checks to show. Follow the SOP steps on this page.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="sop-pack" className={card}>
      <h2 id="sop-pack" className={sectionTitle}>
        SOP pack
      </h2>
      <p className="text-[13px] text-ink-mute mb-4">
        {pack.title}
        {pack.version ? ` · v${pack.version}` : ""} · {pack.source === "published" ? "the active published pack" : "the built-in pack (nothing published yet)"} · {pack.rules.length} checks the agent runs
      </p>
      <ol className="space-y-2.5">
        {pack.rules.map((r) => (
          <li key={r.id} className="rounded-lg border border-border px-3.5 py-2.5">
            <p className="text-[13.5px] font-semibold flex items-start gap-2 flex-wrap">
              <span className={`${chip} ${SEV_TONE[r.severity]}`}>{SEV_LABEL[r.severity]}</span>
              <span className="min-w-0">{r.title}</span>
            </p>
            <p className="text-[11.5px] text-ink-mute mt-0.5">
              Evidence: {r.evidence} · {r.kind === "llm" ? "model check, quoted from the documents" : "rule in code"} · <span className="font-mono">{r.id}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function WorkspacePage({ params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { jobId } = await params;
  const view = await loadWorkspaceView(prisma as unknown as WorkspaceViewDb, session.user, jobId, new Date());
  if (!view) notFound();
  const { job, action } = view;
  const context = `${job.title} for ${job.clientCode}`;

  const run = view.latestRun;
  const deliverables = run ? (
    <>
      <DeliverablesPanel deliverables={view.deliverables} />
      <p className="text-[11.5px] text-ink-mute mt-3 tabular-nums">
        From attempt {run.attempt}, started {run.started}.{" "}
        <Link href={`/agents/${run.agent}/runs/${run.id}`} className={linkText}>
          Open the pack review screen
        </Link>
      </p>
    </>
  ) : (
    <section aria-labelledby="no-deliverables" className={card}>
      <h2 id="no-deliverables" className={sectionTitle}>
        Deliverables
      </h2>
      <p className="text-[13px] text-ink-mute">No agent run yet. The draft pack&apos;s files appear here after the agent runs.</p>
    </section>
  );

  const tabs = [
    { id: "deliverables", label: "Deliverables", count: view.deliverables.length, content: deliverables },
    { id: "documents", label: "Client documents", count: view.clientDocs.files.length, content: <ClientDocsPanel docs={view.clientDocs} /> },
    { id: "sop", label: "SOP pack", content: <SopPackPanel pack={view.sopPack} service={job.service} /> },
  ];

  return (
    <div>
      <BackLink href="/focus">Next task</BackLink>
      <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        {/* Not an <aside>: it holds the page's title and its one primary action. The padding keeps the cards' shadow inside the scroll box. */}
        <div data-panel="job" className="space-y-6 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:px-3 lg:-mx-3 lg:pb-6">
          <section aria-labelledby="job" className={card}>
            <p className={eyebrow}>Guided workspace</p>
            <h1 id="job" className={pageTitle}>
              {job.title}
            </h1>
            <p className="text-ink-mute text-[13.5px] mt-1.5">
              {job.clientName ? `${job.clientName} (${job.clientCode})` : job.clientCode} · {job.service} · <span className="tabular-nums">{job.period} · FY {job.fy}</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <StateChip state={job.state} />
              {view.latestRun && <RunStatusChip status={view.latestRun.status} />}
            </div>
            <div className="mt-2">
              <DueLine internalDue={job.internalDue} statutoryDue={job.statutoryDue} overdue={job.overdue} />
            </div>
            <div className="mt-5 pt-4 border-t border-border">
              <h2 className={sectionTitle}>Next action</h2>
              {action?.kind === "prepare-by-hand" ? (
                <p className="text-[13.5px] text-ink-soft">There is no agent for {job.service} yet. Prepare the work by hand in the job&apos;s Working folder, following the steps below.</p>
              ) : action ? (
                <NextActionButton action={action} jobId={job.id} context={context} />
              ) : (
                <p className="text-[13.5px] text-ink-soft" role="status">
                  Nothing for you to do here right now. {view.waitingOn}
                </p>
              )}
            </div>
          </section>

          {view.portalNote && <PortalNote note={view.portalNote} />}

          <section aria-labelledby="ws-steps" className={card}>
            <SopStepsList steps={view.sopSteps} headingId="ws-steps" />
          </section>
          <section aria-labelledby="ws-before" className={card}>
            <ChecklistList items={view.checklist} headingId="ws-before" />
          </section>
          {view.openQuestions.length > 0 && (
            <section aria-labelledby="ws-questions" className={card}>
              <OpenQuestionsList questions={view.openQuestions} headingId="ws-questions" />
            </section>
          )}
        </div>

        <div className="min-w-0">
          <WorkspaceTabs label="Job documents" tabs={tabs} initial={view.deliverables.length ? "deliverables" : "documents"} />
        </div>
      </div>
    </div>
  );
}

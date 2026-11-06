import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadDraft, type CommsDb } from "@/lib/agents/comms/service";
import { card, formWidth, sectionTitle } from "@/components/ui";
import { HistoryLink } from "@/components/CorrectionHistory";
import { Alert, BackLink, PageHeader } from "@/components/firm-os";
import { DraftActions } from "./DraftActions";

export const dynamic = "force-dynamic";

/** The message as the client reads it: the 15/24 reading size. */
const text = "whitespace-pre-wrap break-words text-[15px] leading-6 font-sans";

// One client message draft: the text (a translation shown beside its English), staff notes and
// tone warnings, and the actions. One primary action, "Open in Outlook draft", plus "Copy".
// Nothing here sends: the person checks the draft in Outlook and sends it from there.
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const r = await loadDraft(prisma as unknown as CommsDb, session.user, id);
  if (!r.ok && r.status === 404) notFound();

  if (!r.ok) {
    return (
      <div>
        <BackLink href="/comms">Client messages</BackLink>
        <Alert tone="warning" role="alert" className={formWidth}>
          {r.error}
        </Alert>
      </div>
    );
  }
  const d = r.data;
  return (
    <div>
      <PageHeader
        back={{ href: `/comms?client=${d.client.code}`, label: "Client messages" }}
        eyebrow={<>{d.kind} · {d.languageLabel} · prepared by {d.by} on {d.createdAt} IST</>}
        title={<>{d.client.name} ({d.client.code})</>}
        meta={d.job ? d.job.label : "General message (no job)"}
      />
      {/* The draft's correction history, and a fix for a wrong entry. */}
      <div className="mb-6">
        <HistoryLink entity="CommsDraft" id={d.id} />
      </div>

      {(d.notes.length > 0 || d.tone.length > 0) && (
        <Alert tone="warning" role="note" title="Check before you send" titleAs="h2" titleId="draft-notes" className="mb-6">
          <ul className="list-disc pl-6 space-y-1">
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {d.tone.map((t) => (
              <li key={t}>Tone: {t}</li>
            ))}
          </ul>
        </Alert>
      )}

      <section aria-labelledby="draft-subject" className={card}>
        <h2 id="draft-subject" className={sectionTitle}>
          Subject
        </h2>
        <p className="text-[15px] leading-6 font-semibold break-words">{d.subject}</p>
        <p className="text-[12px] text-ink-mute mt-2">
          {d.client.contactEmail ? `To: ${d.client.contactEmail} (the client's contact e-mail; change it in Outlook if needed)` : "No contact e-mail on the client record: add the recipient in Outlook."}
        </p>
      </section>

      {d.translated ? (
        <div className="grid lg:grid-cols-2 gap-6 mt-6 items-start">
          <section aria-labelledby="draft-translated" className={card} lang={d.language}>
            <h2 id="draft-translated" className={sectionTitle}>
              {d.languageLabel}
            </h2>
            <div className={text}>{d.translated}</div>
          </section>
          <section aria-labelledby="draft-english" className={card} lang="en">
            <h2 id="draft-english" className={sectionTitle}>
              English (sent below the {d.languageLabel})
            </h2>
            <div className={text}>{d.english}</div>
          </section>
        </div>
      ) : (
        <section aria-labelledby="draft-english" className={`${card} mt-6 max-w-3xl`} lang="en">
          <h2 id="draft-english" className={sectionTitle}>
            Message
          </h2>
          <div className={text}>{d.english}</div>
        </section>
      )}

      <DraftActions id={d.id} subject={d.subject} body={d.body} inOutlook={d.inOutlook} />
    </div>
  );
}

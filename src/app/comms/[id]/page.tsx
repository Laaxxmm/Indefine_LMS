import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadDraft, type CommsDb } from "@/lib/agents/comms/service";
import { card } from "@/components/ui";
import { BackLink, eyebrow, pageTitle, sectionTitle } from "@/app/agents/parts";
import { DraftActions } from "./DraftActions";

export const dynamic = "force-dynamic";

const text = "whitespace-pre-wrap break-words text-[14px] leading-relaxed font-sans";

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
        <p className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13.5px]" role="alert">
          {r.error}
        </p>
      </div>
    );
  }
  const d = r.data;
  return (
    <div>
      <BackLink href={`/comms?client=${d.client.code}`}>Client messages</BackLink>
      <p className={eyebrow}>
        {d.kind} · {d.languageLabel} · prepared by {d.by} on {d.createdAt} IST
      </p>
      <h1 className={pageTitle}>
        {d.client.name} ({d.client.code})
      </h1>
      <p className="text-ink-mute text-[13.5px] mt-1.5">{d.job ? d.job.label : "General message (no job)"}</p>

      {(d.notes.length > 0 || d.tone.length > 0) && (
        <section aria-labelledby="draft-notes" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-[13px]">
          <h2 id="draft-notes" className="font-bold">
            Check before you send
          </h2>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {d.tone.map((t) => (
              <li key={t}>Tone: {t}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="draft-subject" className={`${card} mt-5`}>
        <h2 id="draft-subject" className={sectionTitle}>
          Subject
        </h2>
        <p className="text-[14px] font-semibold break-words">{d.subject}</p>
        <p className="text-[12.5px] text-ink-mute mt-2">
          {d.client.contactEmail ? `To: ${d.client.contactEmail} (the client's contact e-mail; change it in Outlook if needed)` : "No contact e-mail on the client record: add the recipient in Outlook."}
        </p>
      </section>

      {d.translated ? (
        <div className="grid lg:grid-cols-2 gap-5 mt-5 items-start">
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
        <section aria-labelledby="draft-english" className={`${card} mt-5 max-w-[760px]`} lang="en">
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

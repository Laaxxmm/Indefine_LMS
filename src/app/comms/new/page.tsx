import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { listClientOptions, loadDraftContext, type CommsDb } from "@/lib/agents/comms/service";
import { card, field } from "@/components/ui";
import { BackLink, eyebrow, focusRing, pageTitle } from "@/app/agents/parts";
import { DraftForm } from "./DraftForm";

export const dynamic = "force-dynamic";

const primary = `px-4 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition ${focusRing}`;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Z0-9]{3,10}$/;

// The draft panel: reached from an agent run (?run=, documents to ask for pre-filled), a job
// (?job=) or a client page (?client=). Without any of them it asks for the client first.
// One primary action per screen ("Continue", then "Prepare draft"); nothing here sends anything.
export default async function NewDraftPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const sp = await searchParams;
  const q = {
    run: sp.run && ID.test(sp.run) ? sp.run : undefined,
    job: sp.job && ID.test(sp.job) ? sp.job : undefined,
    client: sp.client && CODE.test(sp.client) ? sp.client : undefined,
  };
  const db = prisma as unknown as CommsDb;
  const r = await loadDraftContext(db, session.user, q, new Date());
  if (!r.ok && r.status === 404) notFound();

  return (
    <div className="max-w-[880px]">
      <BackLink href="/comms">Client messages</BackLink>
      <p className={eyebrow}>Draft only · you send it yourself</p>
      <h1 className={pageTitle}>New client message</h1>

      {!r.ok ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13.5px]" role="alert">
          {r.error}
        </p>
      ) : r.data === null ? (
        <ClientPicker clients={await listClientOptions(db, session.user)} />
      ) : (
        <>
          <p className="text-ink-mute text-[14px] mt-1.5 mb-6">
            For <span className="font-semibold text-ink">{r.data.client.name}</span> ({r.data.client.code}). Code writes the message from the job&apos;s facts; the model may only
            polish the wording, and translate it when the client prefers another language. You check it before anything goes out.
          </p>
          <DraftForm ctx={r.data} />
        </>
      )}
    </div>
  );
}

function ClientPicker({ clients }: { clients: { code: string; name: string }[] }) {
  return (
    // A GET form without an action submits to this page (/comms/new?client=…).
    <form method="get" className={`${card} mt-6 max-w-[640px] space-y-4`}>
      <label className="block text-[13px] font-semibold">
        Which client is the message for?
        <select name="client" required className={`${field} mt-1.5 ${focusRing}`} defaultValue="">
          <option value="" disabled>
            Pick a client
          </option>
          {clients.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </label>
      {clients.length === 0 && <p className="text-[13px] text-ink-mute">No Firm OS clients you prepare or review yet.</p>}
      <button type="submit" className={primary} disabled={clients.length === 0}>
        Continue
      </button>
    </form>
  );
}

import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { listClientOptions, loadDraftContext, type CommsDb } from "@/lib/agents/comms/service";
import { card, field, formWidth, labelText } from "@/components/ui";
import { Alert, Button, PageHeader } from "@/components/firm-os";
import { DraftForm } from "./DraftForm";

export const dynamic = "force-dynamic";

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
    <div>
      <PageHeader
        back={{ href: "/comms", label: "Client messages" }}
        eyebrow="Draft only · you send it yourself"
        title="New client message"
        lead={
          r.ok && r.data ? (
            <>
              For <span className="font-semibold text-ink">{r.data.client.name}</span> ({r.data.client.code}). Code writes the message from the job&apos;s facts; the model may only polish the
              wording, and translate it when the client prefers another language. You check it before anything goes out.
            </>
          ) : undefined
        }
      />

      {!r.ok ? (
        <Alert tone="warning" role="alert" className={formWidth}>
          {r.error}
        </Alert>
      ) : r.data === null ? (
        <ClientPicker clients={await listClientOptions(db, session.user)} />
      ) : (
        <DraftForm ctx={r.data} />
      )}
    </div>
  );
}

function ClientPicker({ clients }: { clients: { code: string; name: string }[] }) {
  return (
    // A GET form without an action submits to this page (/comms/new?client=…).
    <form method="get" className={`${card} ${formWidth} space-y-4`}>
      <label className={`flex flex-col gap-1 ${labelText}`}>
        Which client is the message for?
        <select name="client" required className={`${field} font-normal text-ink`} defaultValue="">
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
      <Button type="submit" variant="primary" disabled={clients.length === 0}>
        Continue
      </Button>
    </form>
  );
}

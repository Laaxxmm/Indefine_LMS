import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listClientOptions, listDrafts, type CommsDb } from "@/lib/agents/comms/service";
import { btnGhost, btnPrimary, field, labelText, linkText, td, tr } from "@/components/ui";
import { Chip, DataTable, EmptyState, PageHeader } from "@/components/firm-os";

export const dynamic = "force-dynamic";

const CODE = /^[A-Z0-9]{3,10}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// /comms: client message drafts, newest first, filterable by client (and by job, from a job link).
// One primary action: "New draft". Nothing on this page sends anything.
export default async function CommsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const sp = await searchParams;
  const client = sp.client && CODE.test(sp.client) ? sp.client : undefined;
  const job = sp.job && ID.test(sp.job) ? sp.job : undefined;
  const db = prisma as unknown as CommsDb;
  const [rows, clients] = await Promise.all([listDrafts(db, session.user, { client, job }), listClientOptions(db, session.user)]);
  const newHref = client ? `/comms/new?client=${client}` : "/comms/new";

  return (
    <div>
      <PageHeader
        eyebrow="Firm OS · drafts only"
        title="Client messages"
        lead="Status updates, document requests, due-date reminders, filing notes and answers, drafted from the job's facts. Nothing here sends email: copy a draft, or open it as an Outlook draft in your own mailbox, check it, and send it yourself."
        action={
          <Link href={newHref} className={btnPrimary}>
            New draft
          </Link>
        }
      />

      {/* A GET form without an action submits to this page (/comms?client=…). */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-6" aria-label="Filter drafts">
        <label className={`flex flex-col gap-1 ${labelText}`}>
          Client
          <select name="client" defaultValue={client ?? ""} className={`${field} min-w-[16rem] font-normal text-ink`}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        {job && <input type="hidden" name="job" value={job} />}
        <button type="submit" className={`${btnGhost} h-10`}>
          Filter
        </button>
        {(client || job) && (
          <Link href="/comms" className={`${linkText} text-[13px] self-center`}>
            Clear filter
          </Link>
        )}
        {job && (
          <Chip tone="neutral" className="self-center">
            One job
          </Chip>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No drafts yet">Start one from an agent run, a client page, or New draft.</EmptyState>
      ) : (
        <DataTable
          caption="Client message drafts, newest first"
          columns={[{ label: "Subject" }, { label: "Client" }, { label: "Job" }, { label: "Type" }, { label: "Language" }, { label: "Outlook" }, { label: "Prepared (IST)" }]}
        >
          {rows.map((r) => (
            <tr key={r.id} className={tr}>
              <td className={`${td} max-w-[28rem]`}>
                <Link href={r.href} className={`${linkText} line-clamp-2`}>
                  {r.subject}
                </Link>
              </td>
              <td className={`${td} font-semibold whitespace-nowrap`} title={r.clientName}>
                {r.clientCode}
              </td>
              <td className={`${td} whitespace-nowrap`}>{r.job}</td>
              <td className={`${td} whitespace-nowrap`}>{r.kind}</td>
              <td className={td}>{r.language}</td>
              <td className={`${td} text-ink-mute`}>{r.inOutlook ? "Draft created" : "—"}</td>
              <td className={`${td} text-ink-mute tabular-nums whitespace-nowrap`}>
                {r.createdAt} · {r.by}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

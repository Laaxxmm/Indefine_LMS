import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listClientOptions, listDrafts, type CommsDb } from "@/lib/agents/comms/service";
import { btnGhost, field } from "@/components/ui";
import { EmptyState, chip, eyebrow, focusRing, linkText, pageTitle, tableWrap, td, th, thead } from "@/app/agents/parts";

export const dynamic = "force-dynamic";

const primary = `inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition shrink-0 ${focusRing}`;
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
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className={eyebrow}>Firm OS · drafts only</p>
          <h1 className={pageTitle}>Client messages</h1>
          <p className="text-ink-mute text-[14px] mt-1.5 max-w-2xl">
            Status updates, document requests, due-date reminders, filing notes and answers, drafted from the job&apos;s facts. Nothing here sends email: copy a draft, or
            open it as an Outlook draft in your own mailbox, check it, and send it yourself.
          </p>
        </div>
        <Link href={newHref} className={primary}>
          New draft
        </Link>
      </div>

      {/* A GET form without an action submits to this page (/comms?client=…). */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-5" aria-label="Filter drafts">
        <label className="text-[12px] font-semibold text-ink-mute">
          Client
          <select name="client" defaultValue={client ?? ""} className={`${field} mt-1 min-w-[16rem] ${focusRing}`}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        {job && <input type="hidden" name="job" value={job} />}
        <button type="submit" className={`${btnGhost} ${focusRing} h-9`}>
          Filter
        </button>
        {(client || job) && (
          <Link href="/comms" className={`${linkText} text-[13px] self-center`}>
            Clear filter
          </Link>
        )}
        {job && <span className={`${chip} border-border bg-muted text-ink-soft self-center`}>One job</span>}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No drafts yet">Start one from an agent run, a client page, or New draft.</EmptyState>
      ) : (
        <div className={tableWrap}>
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Client message drafts, newest first</caption>
            <thead className={thead}>
              <tr>
                <th scope="col" className={th}>Subject</th>
                <th scope="col" className={th}>Client</th>
                <th scope="col" className={th}>Job</th>
                <th scope="col" className={th}>Type</th>
                <th scope="col" className={th}>Language</th>
                <th scope="col" className={th}>Outlook</th>
                <th scope="col" className={th}>Prepared (IST)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40 h-11">
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

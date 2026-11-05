import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canSeeAllRuns } from "@/lib/agents/access";
import { canSpotCheck } from "@/lib/rbac/policy";
import { listSpotChecks, type SpotCheckRow } from "@/lib/audit/spot-checks";
import { BackLink, EmptyState, eyebrow, pageTitle, runsListLabel, sectionTitle, tableWrap, td, th, thead } from "../parts";
import { SpotCheckAction } from "./SpotCheckAction";

export const dynamic = "force-dynamic";

const jobLabel = (r: SpotCheckRow) => (r.job ? `${r.job.title} ${r.job.period} for ${r.job.clientCode}` : `Turia close ${r.syncId}`);

function JobCell({ r }: { r: SpotCheckRow }) {
  return r.job ? (
    <>
      <span className="font-semibold">{r.job.title}</span>
      <span className="ml-2 text-[11.5px] text-ink-mute">{r.job.service}</span>
      <span className="block text-[11.5px] text-ink-mute tabular-nums">
        {r.job.period} · FY {r.job.fy}
      </span>
    </>
  ) : (
    <span className="text-ink-mute">Job not found</span>
  );
}

function TuriaCell({ r }: { r: SpotCheckRow }) {
  return (
    <>
      <span className="font-mono text-[12.5px]">{r.turiaRef ?? "—"}</span>
      <span className="block text-[11.5px] text-ink-mute tabular-nums">{r.minutesLogged ?? "—"} min logged</span>
    </>
  );
}

function PendingTable({ rows }: { rows: SpotCheckRow[] }) {
  return (
    <div className={tableWrap}>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Manual Turia closes selected for a partner spot check, oldest first</caption>
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Turia task ref</th>
            <th scope="col" className={th}>Confirmed by</th>
            <th scope="col" className={th}>Selected (IST)</th>
            <th scope="col" className={`${th} text-right`}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.syncId} className="border-t border-border hover:bg-muted/40 align-top">
              <td className={td}>
                <JobCell r={r} />
              </td>
              <td className={`${td} font-semibold`}>{r.job?.clientCode ?? "—"}</td>
              <td className={td}>
                <TuriaCell r={r} />
              </td>
              <td className={td}>{r.confirmedBy}</td>
              <td className={`${td} tabular-nums whitespace-nowrap text-ink-mute`}>{r.selectedAt}</td>
              <td className={`${td} text-right`}>
                <SpotCheckAction syncId={r.syncId} label={jobLabel(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CheckedTable({ rows }: { rows: SpotCheckRow[] }) {
  return (
    <div className={tableWrap}>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Spot checks already recorded, newest first</caption>
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Turia task ref</th>
            <th scope="col" className={th}>Checked by</th>
            <th scope="col" className={th}>Checked (IST)</th>
            <th scope="col" className={th}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.syncId} className="border-t border-border align-top">
              <td className={td}>
                <JobCell r={r} />
              </td>
              <td className={`${td} font-semibold`}>{r.job?.clientCode ?? "—"}</td>
              <td className={td}>
                <TuriaCell r={r} />
              </td>
              <td className={td}>{r.checked?.by}</td>
              <td className={`${td} tabular-nums whitespace-nowrap text-ink-mute`}>{r.checked?.at}</td>
              <td className={`${td} max-w-xs break-words`}>{r.checked?.note ?? <span className="text-ink-mute">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Partner spot checks of manual Turia closes (ADR-005): the close gate selects about one in ten
// manual closes; a partner checks the task ref and minutes in Turia and records it here.
export default async function SpotChecksPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canSpotCheck(session.user)) redirect("/agents");
  const r = await listSpotChecks(prisma, session.user);
  const { pending, checked } = r.ok ? r.data : { pending: [], checked: [] };

  return (
    <div>
      <BackLink href="/agents">{runsListLabel(canSeeAllRuns(session.user))}</BackLink>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS · close loop</p>
        <h1 className={pageTitle}>Turia spot checks</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Staff record Turia closes by hand, so about one in ten is picked for a partner to check. Open the task in Turia, check the task ref and the minutes logged, then record it here.
        </p>
      </div>

      <section aria-labelledby="to-check" className="mb-8">
        <h2 id="to-check" className={sectionTitle}>
          To check ({pending.length})
        </h2>
        {pending.length === 0 ? <EmptyState title="Nothing to check">Closes picked for a spot check appear here when their job is DONE.</EmptyState> : <PendingTable rows={pending} />}
      </section>

      <section aria-labelledby="checked">
        <h2 id="checked" className={sectionTitle}>
          Checked
        </h2>
        {checked.length === 0 ? <EmptyState title="No spot checks recorded yet" /> : <CheckedTable rows={checked} />}
      </section>
    </div>
  );
}

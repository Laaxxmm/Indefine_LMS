import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canSeeAllRuns } from "@/lib/agents/access";
import { canSpotCheck } from "@/lib/rbac/policy";
import { listSpotChecks, type SpotCheckRow } from "@/lib/audit/spot-checks";
import { DataTable, EmptyState, PageHeader, Section } from "@/components/firm-os";
import { td, tr } from "@/components/ui";
import { runsListLabel } from "../parts";
import { SpotCheckAction } from "./SpotCheckAction";

export const dynamic = "force-dynamic";

const jobLabel = (r: SpotCheckRow) => (r.job ? `${r.job.title} ${r.job.period} for ${r.job.clientCode}` : `Turia close ${r.syncId}`);

function JobCell({ r }: { r: SpotCheckRow }) {
  return r.job ? (
    <>
      <span className="font-semibold">{r.job.title}</span>
      <span className="ml-2 text-[12px] text-ink-mute">{r.job.service}</span>
      <span className="block text-[12px] text-ink-mute tabular-nums">
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
      <span className="font-mono text-[12px]">{r.turiaRef ?? "—"}</span>
      <span className="block text-[12px] text-ink-mute tabular-nums">{r.minutesLogged ?? "—"} min logged</span>
    </>
  );
}

function PendingTable({ rows }: { rows: SpotCheckRow[] }) {
  return (
    <DataTable
      caption="Manual Turia closes selected for a partner spot check, oldest first"
      columns={[{ label: "Job" }, { label: "Client" }, { label: "Turia task ref" }, { label: "Confirmed by" }, { label: "Selected (IST)" }, { label: "Action", align: "right", srOnly: true }]}
    >
      {rows.map((r) => (
        <tr key={r.syncId} className={tr}>
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
    </DataTable>
  );
}

function CheckedTable({ rows }: { rows: SpotCheckRow[] }) {
  return (
    <DataTable
      caption="Spot checks already recorded, newest first"
      columns={[{ label: "Job" }, { label: "Client" }, { label: "Turia task ref" }, { label: "Checked by" }, { label: "Checked (IST)" }, { label: "Note" }]}
    >
      {rows.map((r) => (
        <tr key={r.syncId} className={tr}>
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
    </DataTable>
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
      <PageHeader
        back={{ href: "/agents", label: runsListLabel(canSeeAllRuns(session.user)) }}
        eyebrow="Firm OS · close loop"
        title="Turia spot checks"
        lead="Staff record Turia closes by hand, so about one in ten is picked for a partner to check. Open the task in Turia, check the task ref and the minutes logged, then record it here."
      />

      <Section id="to-check" title={<>To check ({pending.length})</>}>
        {pending.length === 0 ? <EmptyState title="Nothing to check">Closes picked for a spot check appear here when their job is DONE.</EmptyState> : <PendingTable rows={pending} />}
      </Section>

      <Section id="checked" title="Checked" last>
        {checked.length === 0 ? <EmptyState title="No spot checks recorded yet" /> : <CheckedTable rows={checked} />}
      </Section>
    </div>
  );
}

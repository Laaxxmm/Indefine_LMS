import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { btnPrimary, card, field, figure, labelText, sectionTitle, td, tdNum, tr } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, Section } from "@/components/firm-os";
import { loadCycleJobs } from "@/lib/close-loop/cycle-time-db";
import {
  STAGE_LABELS,
  formatDayKey,
  formatDuration,
  formatShare,
  parseCycleRange,
  summariseCycleTimes,
  type GroupStats,
  type StageStats,
} from "@/lib/close-loop/cycle-time";

export const dynamic = "force-dynamic";

// Firm OS · cycle time: how long jobs take from assignment to DONE (close gate passed), median and
// p90 per service, person and client, and the stage that takes the largest share of a typical job.
// Reads DONE JobTasks and their append-only JobTaskEvent history only.


function Bottleneck({ g }: { g: GroupStats }) {
  if (!g.bottleneck) return <span className="text-ink-mute">–</span>;
  return (
    <span>
      {STAGE_LABELS[g.bottleneck.stage]} <span className="text-ink-mute tabular-nums">({formatShare(g.bottleneck.share)})</span>
    </span>
  );
}

function GroupTable({ id, title, label, rows }: { id: string; title: string; label: string; rows: GroupStats[] }) {
  return (
    <Section id={id} title={title} last className="min-w-0">
      {rows.length === 0 ? (
        <EmptyState title="No jobs reached DONE in this range." />
      ) : (
        <DataTable
          caption={`Cycle time ${title.toLowerCase()}`}
          columns={[{ label }, { label: "Jobs", align: "right" }, { label: "Median", align: "right" }, { label: "p90", align: "right" }, { label: "Bottleneck stage" }]}
        >
          {rows.map((r) => (
            <tr key={r.key} className={tr}>
              <td className={td}>{r.label}</td>
              <td className={tdNum}>{r.jobs}</td>
              <td className={`${tdNum} font-semibold`}>{formatDuration(r.medianMs)}</td>
              <td className={tdNum}>{formatDuration(r.p90Ms)}</td>
              <td className={td}>
                <Bottleneck g={r} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}


function StageTable({ rows, empty }: { rows: StageStats[]; empty: boolean }) {
  return (
    <Section id="stages" title="Time in each stage" last className="min-w-0">
      {empty ? (
        <EmptyState title="No jobs reached DONE in this range." />
      ) : (
        <DataTable caption="Median and p90 time in each stage" columns={[{ label: "Stage" }, { label: "Median", align: "right" }, { label: "p90", align: "right" }]}>
          {rows.map((r) => (
            <tr key={r.stage} className={tr}>
              <td className={td}>{r.label}</td>
              <td className={`${tdNum} font-semibold`}>{formatDuration(r.medianMs)}</td>
              <td className={tdNum}>{formatDuration(r.p90Ms)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

export default async function CycleTimePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const range = parseCycleRange(sp.from, sp.to, new Date());
  const { jobs, capped } = await loadCycleJobs(range.from, range.to);
  const summary = summariseCycleTimes(jobs);
  const o = summary.overall;

  const stats = [
    { label: "Jobs done", value: String(o.jobs) },
    { label: "Median, assigned to done", value: formatDuration(o.medianMs) },
    { label: "p90, assigned to done", value: formatDuration(o.p90Ms) },
    { label: "Bottleneck stage", value: o.bottleneck ? STAGE_LABELS[o.bottleneck.stage] : "–" },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        eyebrow="Admin · Firm OS"
        title="Cycle time"
        lead={`Jobs that reached DONE from ${formatDayKey(range.fromKey)} to ${formatDayKey(range.toKey)} (IST), assignment to close.`}
      />

      <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`} aria-label="Date range">
        <label className={`flex flex-col gap-1 ${labelText}`}>
          From
          <input type="date" name="from" defaultValue={range.fromKey} className={`${field} w-auto font-normal text-ink tabular-nums`} />
        </label>
        <label className={`flex flex-col gap-1 ${labelText}`}>
          To
          <input type="date" name="to" defaultValue={range.toKey} className={`${field} w-auto font-normal text-ink tabular-nums`} />
        </label>
        <button type="submit" className={`${btnPrimary} h-9`}>
          Apply
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={sectionTitle}>{s.label}</p>
            <p className={figure}>{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[13px] leading-5 text-ink-mute mb-6 max-w-3xl">
        Median and p90 are over each job&apos;s time from assignment to DONE. The bottleneck is the stage with the largest median share of a job&apos;s
        time. &ldquo;Waiting on client&rdquo; counts time after a change marked &ldquo;waiting on client&rdquo; in its note.
        {capped && " Only the first 5,000 jobs in this range are included; narrow the range."}
      </p>

      <div className="space-y-8">
        <StageTable rows={summary.stages} empty={o.jobs === 0} />
        <GroupTable id="by-service" title="By service" label="Service" rows={summary.byService} />
        <div className="grid lg:grid-cols-2 gap-6">
          <GroupTable id="by-person" title="By person (assignee)" label="Person" rows={summary.byPerson} />
          <GroupTable id="by-client" title="By client" label="Client" rows={summary.byClient} />
        </div>
      </div>
    </main>
  );
}

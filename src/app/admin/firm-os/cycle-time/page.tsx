import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { card } from "@/components/ui";
import { eyebrow, focusRing, sectionTitle } from "@/app/agents/parts";
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

const num = "text-right tabular-nums";
const headCell = "font-semibold py-2.5";

function Bottleneck({ g }: { g: GroupStats }) {
  if (!g.bottleneck) return <span className="text-ink-mute">–</span>;
  return (
    <span>
      {STAGE_LABELS[g.bottleneck.stage]} <span className="text-ink-mute tabular-nums">({formatShare(g.bottleneck.share)})</span>
    </span>
  );
}

function GroupTable({ title, label, rows }: { title: string; label: string; rows: GroupStats[] }) {
  return (
    <section className={card}>
      <h2 className={sectionTitle}>{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-mute">No jobs reached DONE in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-mute">
              <tr className="border-b border-border">
                <th scope="col" className={`text-left ${headCell} pr-3`}>{label}</th>
                <th scope="col" className={`${num} ${headCell} px-3`}>Jobs</th>
                <th scope="col" className={`${num} ${headCell} px-3`}>Median</th>
                <th scope="col" className={`${num} ${headCell} px-3`}>p90</th>
                <th scope="col" className={`text-left ${headCell} pl-3`}>Bottleneck stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0 h-11">
                  <td className="pr-3">{r.label}</td>
                  <td className={`${num} px-3`}>{r.jobs}</td>
                  <td className={`${num} px-3 font-semibold`}>{formatDuration(r.medianMs)}</td>
                  <td className={`${num} px-3`}>{formatDuration(r.p90Ms)}</td>
                  <td className="pl-3">
                    <Bottleneck g={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StageTable({ rows, empty }: { rows: StageStats[]; empty: boolean }) {
  return (
    <section className={card}>
      <h2 className={sectionTitle}>Time in each stage</h2>
      {empty ? (
        <p className="text-sm text-ink-mute">No jobs reached DONE in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-mute">
              <tr className="border-b border-border">
                <th scope="col" className={`text-left ${headCell} pr-3`}>Stage</th>
                <th scope="col" className={`${num} ${headCell} px-3`}>Median</th>
                <th scope="col" className={`${num} ${headCell} pl-3`}>p90</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stage} className="border-b border-border last:border-0 h-11">
                  <td className="pr-3">{r.label}</td>
                  <td className={`${num} px-3 font-semibold`}>{formatDuration(r.medianMs)}</td>
                  <td className={`${num} pl-3`}>{formatDuration(r.p90Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className={`${eyebrow} mb-1.5`}>Admin · Firm OS</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">Cycle time</h1>
          <p className="text-sm text-ink-mute mt-2">
            Jobs that reached DONE from {formatDayKey(range.fromKey)} to {formatDayKey(range.toKey)} (IST), assignment to close.
          </p>
        </div>
        <Link
          href="/admin"
          className={`text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0 ${focusRing}`}
        >
          ← Admin
        </Link>
      </div>

      <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`}>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">From</span>
          <input type="date" name="from" defaultValue={range.fromKey} className={`bg-white border border-border rounded-lg px-3 py-2 tabular-nums ${focusRing}`} />
        </label>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">To</span>
          <input type="date" name="to" defaultValue={range.toKey} className={`bg-white border border-border rounded-lg px-3 py-2 tabular-nums ${focusRing}`} />
        </label>
        <button className={`px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold ${focusRing}`}>Apply</button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={sectionTitle}>{s.label}</p>
            <p className="font-display text-[26px] font-extrabold tabular-nums leading-none">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-ink-mute mb-6">
        Median and p90 are over each job&apos;s time from assignment to DONE. The bottleneck is the stage with the largest median share of a job&apos;s
        time. &ldquo;Waiting on client&rdquo; counts time after a change marked &ldquo;waiting on client&rdquo; in its note.
        {capped && " Only the first 5,000 jobs in this range are included; narrow the range."}
      </p>

      <div className="space-y-6">
        <StageTable rows={summary.stages} empty={o.jobs === 0} />
        <GroupTable title="By service" label="Service" rows={summary.byService} />
        <div className="grid lg:grid-cols-2 gap-6">
          <GroupTable title="By person (assignee)" label="Person" rows={summary.byPerson} />
          <GroupTable title="By client" label="Client" rows={summary.byClient} />
        </div>
      </div>
    </main>
  );
}

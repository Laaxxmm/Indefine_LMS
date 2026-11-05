import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { card } from "@/components/ui";
import { eyebrow, focusRing, sectionTitle } from "@/app/agents/parts";
import { formatDayKey as formatDayKeyStrict } from "@/lib/agents/core/format";
import { loadModelCalls } from "@/lib/ai/db";
import { formatCount, formatInr, parseUsageRange, summariseUsage, type UsageBucket } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

// Firm OS · ModelRouter usage: what the AI layer cost (₹) and how often it escalated or handed
// work to a human. Reads ModelCall rows only (prompt hashes, never prompt text).

const num = "text-right tabular-nums";

/** DD MMM YYYY with fixed month names (en-IN locale data writes September as "Sept"). */
const formatDayKey = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(key) ? formatDayKeyStrict(key) : key);

function UsageTable({ title, label, rows, keyLabel }: { title: string; label: string; rows: UsageBucket[]; keyLabel?: (k: string) => string }) {
  return (
    <section className={card}>
      <h2 className={sectionTitle}>{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-mute">No model calls in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-mute">
              <tr className="border-b border-border">
                <th scope="col" className="text-left font-semibold py-2.5 pr-3">{label}</th>
                <th scope="col" className={`${num} font-semibold py-2.5 px-3`}>Cost</th>
                <th scope="col" className={`${num} font-semibold py-2.5 px-3`}>Calls</th>
                <th scope="col" className={`${num} font-semibold py-2.5 px-3`}>Escalations</th>
                <th scope="col" className={`${num} font-semibold py-2.5 pl-3`}>Queued for human</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0 h-11">
                  <td className="pr-3">{keyLabel ? keyLabel(r.key) : r.key}</td>
                  <td className={`${num} px-3 font-semibold`}>{formatInr(r.costInr)}</td>
                  <td className={`${num} px-3`}>{formatCount(r.calls)}</td>
                  <td className={`${num} px-3`}>{formatCount(r.escalations)}</td>
                  <td className={`${num} pl-3`}>{formatCount(r.queued)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", grok: "Grok", local: "Local model", none: "No provider (queued / refused)" };

export default async function ModelUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const range = parseUsageRange(sp.from, sp.to, new Date());
  const summary = summariseUsage(await loadModelCalls(range.from, range.to));
  const t = summary.totals;

  const stats = [
    { label: "Cost", value: formatInr(t.costInr) },
    { label: "Model calls", value: formatCount(t.calls) },
    { label: "Escalations", value: formatCount(t.escalations) },
    { label: "Queued for human", value: formatCount(t.queued) },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className={`${eyebrow} mb-1.5`}>Admin · Firm OS</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">Model usage</h1>
          <p className="text-sm text-ink-mute mt-2">
            ModelRouter cost and outcomes, {formatDayKey(range.fromKey)} to {formatDayKey(range.toKey)} (IST).
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
        <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
          Apply
        </button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={sectionTitle}>{s.label}</p>
            <p className="font-display text-[26px] font-extrabold tabular-nums leading-none">{s.value}</p>
          </div>
        ))}
      </div>
      {t.refused > 0 && (
        <p className="text-sm text-ink-mute mb-6">
          {formatCount(t.refused)} call{t.refused === 1 ? " was" : "s were"} refused by the budget guard (per-run limit or AI_DAILY_BUDGET_INR).
        </p>
      )}

      <div className="space-y-6">
        <UsageTable title="By day" label="Day" rows={summary.byDay} keyLabel={formatDayKey} />
        <div className="grid lg:grid-cols-2 gap-6">
          <UsageTable title="By agent" label="Agent" rows={summary.byAgent} />
          <UsageTable title="By provider" label="Provider" rows={summary.byProvider} keyLabel={(k) => PROVIDER_LABEL[k] ?? k} />
        </div>
      </div>
    </main>
  );
}

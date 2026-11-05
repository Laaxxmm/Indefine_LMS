import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { card, h2 } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { loadModelCalls } from "@/lib/ai/db";
import {
  GUARDRAIL_METRICS,
  GUARDRAIL_METRIC_LABELS,
  formatCount,
  formatDayKey,
  formatInr,
  formatRate,
  guardrailRates,
  guardrailThresholdEnv,
  loadGuardrailThresholds,
  parseUsageRange,
  summariseUsage,
  type GuardrailDay,
  type GuardrailThresholds,
  type UsageBucket,
} from "@/lib/ai/usage";
import { loadGuardrailSignals, recordGuardrailBreaches } from "@/lib/agents/core/guardrails/drift-db";

export const dynamic = "force-dynamic";

// Firm OS · ModelRouter usage: what the AI layer cost (₹) and how often it escalated or handed
// work to a human. Reads ModelCall rows only (prompt hashes, never prompt text). The Guardrails
// section (ADR-008 §9) shows per-agent per-day drift rates against env-overridable thresholds;
// loading the page records one `guardrail-breach` AuditEvent per agent per day that breaches.

const num = "text-right tabular-nums";

function GuardrailsTable({ days, th }: { days: GuardrailDay[]; th: GuardrailThresholds }) {
  const breached = days.filter((d) => d.breaches.length > 0).length;
  return (
    <section className={card} aria-labelledby="guardrails-heading">
      <h2 id="guardrails-heading" className={h2}>
        Guardrails
      </h2>
      <p className="text-sm text-ink-mute mb-3">
        Drift per agent per day (ADR-008). A rate breaches when it is above its limit and has at least {formatCount(th.minSample)} cases; any scope violation
        breaches. Limits:{" "}
        {GUARDRAIL_METRICS.map((m) => `${GUARDRAIL_METRIC_LABELS[m]} ${Math.round(th[m] * 1000) / 10}%`).join(" · ")}. Override with{" "}
        <code className="text-xs">{guardrailThresholdEnv("schemaFail")}</code> and the other <code className="text-xs">GUARDRAIL_*</code> settings.
      </p>
      {days.length === 0 ? (
        <p className="text-sm text-ink-mute">No agent activity in this range.</p>
      ) : (
        <>
          {breached > 0 && (
            <p className="text-sm font-semibold text-red-700 mb-3" role="status">
              {formatCount(breached)} agent-day{breached === 1 ? "" : "s"} breached a guardrail limit.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-mute">
                <tr className="border-b border-border">
                  <th scope="col" className="text-left font-semibold py-2.5 pr-3">Day</th>
                  <th scope="col" className="text-left font-semibold py-2.5 px-3">Agent</th>
                  {GUARDRAIL_METRICS.map((m) => (
                    <th key={m} scope="col" className={`${num} font-semibold py-2.5 px-3`}>
                      {GUARDRAIL_METRIC_LABELS[m]}
                    </th>
                  ))}
                  <th scope="col" className={`${num} font-semibold py-2.5 px-3`}>Scope violations</th>
                  <th scope="col" className="text-left font-semibold py-2.5 pl-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const hit = new Set(d.breaches.map((b) => b.metric));
                  return (
                    <tr key={`${d.agent}:${d.day}`} className="border-b border-border last:border-0 h-11">
                      <td className="pr-3 whitespace-nowrap">{formatDayKey(d.day)}</td>
                      <td className="px-3">{d.agent}</td>
                      {GUARDRAIL_METRICS.map((m) => (
                        <td key={m} className={`${num} px-3 ${hit.has(m) ? "font-semibold text-red-700" : ""}`} title={`${formatCount(d.rates[m].n)} of ${formatCount(d.rates[m].d)}`}>
                          {formatRate(d.rates[m])}
                        </td>
                      ))}
                      <td className={`${num} px-3 ${d.scopeViolations > 0 ? "font-semibold text-red-700" : ""}`}>{formatCount(d.scopeViolations)}</td>
                      <td className="pl-3">
                        {d.breaches.length > 0 ? (
                          <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
                            Breach: {d.breaches.map((b) => GUARDRAIL_METRIC_LABELS[b.metric]).join(", ")}
                          </span>
                        ) : (
                          <span className="text-ink-mute">Within limits</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function UsageTable({ title, label, rows, keyLabel }: { title: string; label: string; rows: UsageBucket[]; keyLabel?: (k: string) => string }) {
  return (
    <section className={card}>
      <h2 className={h2}>{title}</h2>
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
  const calls = await loadModelCalls(range.from, range.to);
  const summary = summariseUsage(calls);
  const t = summary.totals;
  const thresholds = loadGuardrailThresholds();
  const signals = await loadGuardrailSignals(range.from, range.to, prisma);
  const guardrailDays = guardrailRates(calls, signals.runs, signals.reviews, thresholds);
  await recordGuardrailBreaches(guardrailDays, prisma);

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
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-ink-faint mb-1.5">Admin · Firm OS</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">Model usage</h1>
          <p className="text-sm text-ink-mute mt-2">
            ModelRouter cost and outcomes, {formatDayKey(range.fromKey)} to {formatDayKey(range.toKey)} (IST).
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0"
        >
          ← Admin
        </Link>
      </div>

      <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`}>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">From</span>
          <input type="date" name="from" defaultValue={range.fromKey} className="bg-white border border-border rounded-lg px-3 py-2 tabular-nums" />
        </label>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">To</span>
          <input type="date" name="to" defaultValue={range.toKey} className="bg-white border border-border rounded-lg px-3 py-2 tabular-nums" />
        </label>
        <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
          Apply
        </button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={h2}>{s.label}</p>
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
        <GuardrailsTable days={guardrailDays} th={thresholds} />
      </div>
    </main>
  );
}

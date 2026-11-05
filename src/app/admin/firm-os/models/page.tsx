import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { btnPrimary, card, field, figure, labelText, sectionTitle, td, tdNum, tr } from "@/components/ui";
import { Alert, Chip, DataTable, EmptyState, PageHeader, Section } from "@/components/firm-os";
import { prisma } from "@/lib/prisma";
import { formatDayKey as formatDayKeyStrict } from "@/lib/agents/core/format";
import { loadModelCalls } from "@/lib/ai/db";
import { getAgent } from "@/lib/agents/registry";
import {
  GUARDRAIL_METRICS,
  GUARDRAIL_METRIC_LABELS,
  breachLabel,
  formatCount,
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
import { hallucinationBudgetFor } from "@/lib/agents/core/guardrails/limits";

export const dynamic = "force-dynamic";

// Firm OS · ModelRouter usage: what the AI layer cost (₹) and how often it escalated or handed
// work to a human. Reads ModelCall rows only (prompt hashes, never prompt text). The Guardrails
// section (ADR-008 §9) shows per-agent per-day drift rates against env-overridable thresholds;
// loading the page records one `guardrail-breach` AuditEvent per agent per day that breaches.


/** DD MMM YYYY with fixed month names (en-IN locale data writes September as "Sept"). */
const formatDayKey = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(key) ? formatDayKeyStrict(key) : key);

function GuardrailsTable({ days, th }: { days: GuardrailDay[]; th: GuardrailThresholds }) {
  const breached = days.filter((d) => d.breaches.length > 0).length;
  return (
    <Section id="guardrails-heading" title="Guardrails" last className="min-w-0">
      <p className="text-[13px] leading-5 text-ink-mute mb-4 max-w-3xl">
        Drift per agent per day (ADR-008, ADR-009). A rate breaches when it is above its limit and has at least {formatCount(th.minSample)} cases; any scope violation breaches, and so does a task
        whose share of ungrounded answers is over its hallucination budget. Limits: {GUARDRAIL_METRICS.map((m) => `${GUARDRAIL_METRIC_LABELS[m]} ${Math.round(th[m] * 1000) / 10}%`).join(" · ")}.
        Override with <code className="text-[12px]">{guardrailThresholdEnv("schemaFail")}</code> and the other <code className="text-[12px]">GUARDRAIL_*</code> settings.
      </p>
      {days.length === 0 ? (
        <EmptyState title="No agent activity in this range." />
      ) : (
        <>
          {breached > 0 && (
            <Alert tone="error" role="status" className="mb-4">
              {formatCount(breached)} agent-day{breached === 1 ? "" : "s"} breached a guardrail limit.
            </Alert>
          )}
          <DataTable
            caption="Guardrail rates per agent per day"
            columns={[
              { label: "Day" },
              { label: "Agent" },
              ...GUARDRAIL_METRICS.map((m) => ({ label: GUARDRAIL_METRIC_LABELS[m], align: "right" as const })),
              { label: "Scope violations", align: "right" },
              { label: "Hallucination (worst task vs budget)" },
              { label: "Injections withheld", align: "right" },
              { label: "Status" },
            ]}
          >
            {days.map((d) => {
              const hit = new Set(d.breaches.map((b) => b.metric));
              return (
                <tr key={`${d.agent}:${d.day}`} className={tr}>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDayKey(d.day)}</td>
                  <td className={td}>{d.agent}</td>
                  {GUARDRAIL_METRICS.map((m) => (
                    <td key={m} className={`${tdNum} ${hit.has(m) ? "font-semibold text-rose-700" : ""}`} title={`${formatCount(d.rates[m].n)} of ${formatCount(d.rates[m].d)}`}>
                      {formatRate(d.rates[m])}
                    </td>
                  ))}
                  <td className={`${tdNum} ${d.scopeViolations > 0 ? "font-semibold text-rose-700" : ""}`}>{formatCount(d.scopeViolations)}</td>
                  <td className={`${td} ${d.hallucination[0]?.breach ? "font-semibold text-rose-700" : ""}`} title={d.hallucination.map((h) => `${h.task}: ${formatRate(h.rate)} of ${formatCount(h.rate.d)}, budget ${Math.round(h.budget * 1000) / 10}%`).join("; ")}>
                    {d.hallucination[0] ? `${formatRate(d.hallucination[0].rate)} ${d.hallucination[0].task} (budget ${Math.round(d.hallucination[0].budget * 1000) / 10}%)` : "—"}
                  </td>
                  <td className={`${tdNum} ${d.injections > 0 ? "font-semibold text-rose-700" : ""}`}>{formatCount(d.injections)}</td>
                  <td className={td}>
                    {d.breaches.length > 0 ? <Chip tone="danger">Breach: {d.breaches.map(breachLabel).join(", ")}</Chip> : <span className="text-ink-mute">Within limits</span>}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </>
      )}
    </Section>
  );
}

function UsageTable({ id, title, label, rows, keyLabel }: { id: string; title: string; label: string; rows: UsageBucket[]; keyLabel?: (k: string) => string }) {
  return (
    <Section id={id} title={title} last className="min-w-0">
      {rows.length === 0 ? (
        <EmptyState title="No model calls in this range." />
      ) : (
        <DataTable
          caption={`Model usage ${title.toLowerCase()}`}
          columns={[{ label }, { label: "Cost", align: "right" }, { label: "Calls", align: "right" }, { label: "Escalations", align: "right" }, { label: "Queued for human", align: "right" }]}
        >
          {rows.map((r) => (
            <tr key={r.key} className={tr}>
              <td className={td}>{keyLabel ? keyLabel(r.key) : r.key}</td>
              <td className={`${tdNum} font-semibold`}>{formatInr(r.costInr)}</td>
              <td className={tdNum}>{formatCount(r.calls)}</td>
              <td className={tdNum}>{formatCount(r.escalations)}</td>
              <td className={tdNum}>{formatCount(r.queued)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
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
  const guardrailDays = guardrailRates(calls, signals.runs, signals.reviews, thresholds, hallucinationBudgetFor);
  await recordGuardrailBreaches(guardrailDays, prisma);

  const stats = [
    { label: "Cost", value: formatInr(t.costInr) },
    { label: "Model calls", value: formatCount(t.calls) },
    { label: "Escalations", value: formatCount(t.escalations) },
    { label: "Queued for human", value: formatCount(t.queued) },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        eyebrow="Admin · Firm OS"
        title="Model usage"
        lead={`ModelRouter cost and outcomes, ${formatDayKey(range.fromKey)} to ${formatDayKey(range.toKey)} (IST).`}
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
      {t.refused > 0 && (
        <p className="text-[13px] leading-5 text-ink-mute mb-6">
          {formatCount(t.refused)} call{t.refused === 1 ? " was" : "s were"} refused by the budget guard (per-run limit or AI_DAILY_BUDGET_INR).
        </p>
      )}

      <div className="space-y-8">
        <UsageTable id="by-day" title="By day" label="Day" rows={summary.byDay} keyLabel={formatDayKey} />
        <div className="grid lg:grid-cols-2 gap-6">
          <UsageTable id="by-agent" title="By agent" label="Agent" rows={summary.byAgent} keyLabel={(k) => getAgent(k)?.title ?? (k === "unassigned" ? "Not tied to an agent" : k)} />
          <UsageTable id="by-provider" title="By provider" label="Provider" rows={summary.byProvider} keyLabel={(k) => PROVIDER_LABEL[k] ?? k} />
        </div>
        <GuardrailsTable days={guardrailDays} th={thresholds} />
      </div>
    </main>
  );
}

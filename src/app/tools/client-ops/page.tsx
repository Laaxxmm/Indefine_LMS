import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarClock, IndianRupee, Plus, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CERT_ALARM_DAYS,
  CYCLE_LABELS,
  KIND_LABELS,
  WINDOWS,
  annualised,
  canUseClientOps,
  daysLeft,
  inr,
  relativeDays,
  shortDate,
  statusOf,
} from "@/lib/client-ops/core";
import { addClient, addSubscription, refreshNow } from "./actions";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";
const label = "flex flex-col gap-1";
const labelText = "text-[11px] font-bold text-ink-mute";

const PILL: Record<string, string> = {
  expired: "bg-rose-50 text-rose-600 border-rose-200",
  expiring: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold ${PILL[tone]}`}>{children}</span>;
}

function Stat({
  icon: Icon,
  value,
  caption,
  accent,
}: {
  icon: typeof Wallet;
  value: string | number;
  caption: string;
  accent: string;
}) {
  return (
    <div className="bg-card border border-border rounded-[20px] p-4 shadow-lift">
      <div className="w-9 h-9 rounded-[12px] grid place-items-center mb-3" style={{ background: `${accent}18`, color: accent }}>
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <div className="font-display font-extrabold text-2xl tracking-[-0.02em]">{value}</div>
      <div className="text-[12px] text-ink-mute mt-0.5">{caption}</div>
    </div>
  );
}

export default async function ClientOpsDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseClientOps(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  // "all" is the escape hatch: without it a portfolio that renews next year looks empty.
  const showAll = sp.days === "all";
  const win = showAll ? Infinity : WINDOWS.includes(Number(sp.days) as (typeof WINDOWS)[number]) ? Number(sp.days) : 30;

  const [subscriptions, clients, reminders] = await Promise.all([
    prisma.opsSubscription.findMany({
      where: { active: true },
      orderBy: { expiresOn: "asc" },
      include: {
        client: { select: { id: true, name: true, email: true } },
        reminders: { orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
      },
    }),
    prisma.opsClient.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.opsReminder.findMany({
      orderBy: { sentAt: "desc" },
      take: 8,
      include: { subscription: { include: { client: { select: { name: true } } } }, sentBy: { select: { name: true } } },
    }),
  ]);

  const rows = subscriptions.map((s) => ({
    ...s,
    left: daysLeft(s.expiresOn),
    status: statusOf(s.expiresOn),
    certLeft: s.sslExpiresOn ? daysLeft(s.sslExpiresOn) : null,
  }));

  // Money follows the billing window only. A row pulled in by a certificate alarm is not
  // revenue due — it is a job to do.
  const dueBilling = rows.filter((r) => r.left <= win);
  const certAlarms = rows.filter((r) => r.certLeft !== null && r.certLeft <= CERT_ALARM_DAYS);
  const listed = rows.filter((r) => r.left <= win || (r.certLeft !== null && r.certLeft <= CERT_ALARM_DAYS));

  const billable = dueBilling.reduce((t, r) => t + r.chargeAmount, 0);
  const margin = dueBilling.reduce((t, r) => t + r.chargeAmount - (r.costPaid ?? 0), 0);
  const runRate = rows.reduce((t, r) => t + annualised(r), 0);
  const checkable = rows.filter((r) => r.domain || r.sslHost);
  const lastChecked = checkable.map((r) => r.checkedAt).filter(Boolean).sort((a, b) => +b! - +a!)[0];
  const countIn = (n: number) => rows.filter((r) => r.left <= n).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Workspace</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Client ops</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
            Hosting and domain renewals for the studio&apos;s web clients — what expires when, what we bill for it, and who still needs asking.
          </p>
        </div>
        <form action={refreshNow}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh checks
          </button>
          <p className="text-[11.5px] text-ink-faint mt-2 text-right">
            {lastChecked
              ? `Checked ${shortDate(lastChecked)} · ${checkable.length} looked up`
              : `${checkable.length} ${checkable.length === 1 ? "service has" : "services have"} a domain or host to check`}
          </p>
        </form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat icon={AlertTriangle} value={rows.filter((r) => r.status === "expired").length} caption="Expired" accent="#f43f5e" />
        <Stat icon={CalendarClock} value={countIn(30)} caption="Due in 30 days" accent="#ffb020" />
        <Stat icon={IndianRupee} value={inr(billable)} caption={showAll ? "Billable, all tracked" : `Billable in ${win} days`} accent="#5b4be6" />
        <Stat icon={Wallet} value={inr(margin)} caption="Margin over cost" accent="#17b978" />
        <Stat icon={ShieldCheck} value={certAlarms.length} caption={`Certs under ${CERT_ALARM_DAYS} days`} accent="#0ea5e9" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex gap-2 flex-wrap">
          {WINDOWS.map((n) => (
            <Link
              key={n}
              href={`/tools/client-ops?days=${n}`}
              className={`px-4 py-2 rounded-full text-[13px] font-bold border transition ${
                n === win ? "bg-ink text-white border-ink" : "bg-card text-ink-mute border-border hover:text-ink"
              }`}
            >
              Next {n} days · {countIn(n)}
            </Link>
          ))}
          <Link
            href="/tools/client-ops?days=all"
            className={`px-4 py-2 rounded-full text-[13px] font-bold border transition ${
              showAll ? "bg-ink text-white border-ink" : "bg-card text-ink-mute border-border hover:text-ink"
            }`}
          >
            Everything · {rows.length}
          </Link>
        </div>
        <p className="text-[12px] text-ink-faint">
          Annual run-rate across {rows.length} services: <span className="font-bold text-ink-mute">{inr(runRate)}</span>
        </p>
      </div>

      {listed.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <CalendarClock className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">{rows.length === 0 ? "No services tracked yet" : `Nothing due in the next ${win} days`}</p>
          <p className="text-[13px] text-ink-mute mt-1">
            {rows.length === 0 ? (
              "Add a client below, then add the domains and hosting you renew for them."
            ) : (
              <>
                {rows.length} tracked {rows.length === 1 ? "service renews" : "services renew"} later than that —{" "}
                <Link href="/tools/client-ops?days=all" className="font-bold text-brand-500 hover:text-brand-600">see everything</Link>.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <table className="w-full text-[13.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Renews</th>
                <th className="px-4 py-3">Certificate</th>
                <th className="px-4 py-3 text-right">We pay</th>
                <th className="px-4 py-3 text-right">We charge</th>
                <th className="px-4 py-3">Reminder</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {listed.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{r.client.name}</div>
                    <div className="text-[12px] text-ink-faint">{r.client.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{KIND_LABELS[r.kind]} · {r.provider}</div>
                    <div className="text-[12px] text-ink-faint">{CYCLE_LABELS[r.cycle]}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{shortDate(r.expiresOn)}</span>
                      <Pill tone={r.status}>{r.status === "expiring" ? "expiring" : r.status}</Pill>
                    </div>
                    <div className="text-[12px] text-ink-faint">{relativeDays(r.left)}</div>
                  </td>
                  <td className="px-4 py-3 max-w-[230px]">
                    {r.sslExpiresOn && r.certLeft !== null ? (
                      <div className="flex items-center gap-2">
                        <Pill tone={r.certLeft < 0 ? "expired" : r.certLeft <= CERT_ALARM_DAYS ? "expiring" : "active"}>
                          {r.certLeft < 0 ? "expired" : `${r.certLeft}d`}
                        </Pill>
                        <span className="text-[12px] text-ink-faint">{shortDate(r.sslExpiresOn)}</span>
                      </div>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                    {r.checkNote && <div className="text-[11px] text-ink-faint leading-snug mt-1">{r.checkNote}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-mute">{inr(r.costPaid)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{inr(r.chargeAmount)}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-mute whitespace-nowrap">
                    {r.reminders[0] ? shortDate(r.reminders[0].sentAt) : <span className="text-ink-faint">never</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/tools/client-ops/${r.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[12.5px] font-bold text-ink-mute hover:text-ink hover:bg-muted transition whitespace-nowrap"
                    >
                      Reminder <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <details className="bg-card border border-border rounded-[20px] p-5 shadow-lift">
          <summary className="cursor-pointer font-display font-bold text-[15px] flex items-center gap-2">
            <Plus className="w-4 h-4 text-brand-500" /> Add a web client
          </summary>
          <form action={addClient} className="grid sm:grid-cols-2 gap-3 mt-4">
            <label className={label}><span className={labelText}>Name</span><input name="name" required className={field} /></label>
            <label className={label}><span className={labelText}>Billing email</span><input name="email" type="email" required className={field} /></label>
            <label className={`${label} sm:col-span-2`}><span className={labelText}>Contact person (optional)</span><input name="contact" className={field} /></label>
            <button type="submit" className="justify-self-start px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Add client</button>
          </form>
        </details>

        <details className="bg-card border border-border rounded-[20px] p-5 shadow-lift">
          <summary className="cursor-pointer font-display font-bold text-[15px] flex items-center gap-2">
            <Plus className="w-4 h-4 text-accent-mint" /> Add a service
          </summary>
          {clients.length === 0 ? (
            <p className="text-[13px] text-ink-mute mt-3">Add a client first.</p>
          ) : (
            <form action={addSubscription} className="grid sm:grid-cols-2 gap-3 mt-4">
              <label className={label}><span className={labelText}>Client</span>
                <select name="clientId" className={field}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <label className={label}><span className={labelText}>Kind</span>
                <select name="kind" className={field}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className={label}><span className={labelText}>Provider</span><input name="provider" required placeholder="GoDaddy, Hostinger…" className={field} /></label>
              <label className={label}><span className={labelText}>Renews on</span><input name="expiresOn" type="date" required className={field} /></label>
              <label className={label}><span className={labelText}>Cycle</span>
                <select name="cycle" className={field}><option value="YEARLY">Yearly</option><option value="MONTHLY">Monthly</option></select>
              </label>
              <label className={label}><span className={labelText}>We pay (₹)</span><input name="costPaid" type="number" min="0" step="1" className={field} /></label>
              <label className={label}><span className={labelText}>We charge (₹)</span><input name="chargeAmount" type="number" min="0" step="1" required className={field} /></label>
              <label className={label}><span className={labelText}>Renewal link</span><input name="renewalLink" className={field} /></label>
              <label className={label}><span className={labelText}>Domain for registry check</span><input name="domain" placeholder="client.in" className={field} /></label>
              <label className={label}><span className={labelText}>Host for certificate check</span><input name="sslHost" placeholder="www.client.in" className={field} /></label>
              <button type="submit" className="justify-self-start px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition sm:col-span-2">Add service</button>
            </form>
          )}
        </details>
      </div>

      <h2 className="font-display font-bold text-lg mt-8 mb-3">Reminder log</h2>
      {reminders.length === 0 ? (
        <p className="text-[13px] text-ink-mute">Nothing sent yet. Open a service and mark a reminder once you&apos;ve emailed the client.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">By</th></tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-mute">{shortDate(r.sentAt)}</td>
                  <td className="px-4 py-2.5 font-semibold">{r.subscription.client.name}</td>
                  <td className="px-4 py-2.5 text-ink-mute">{r.subject}</td>
                  <td className="px-4 py-2.5 text-ink-faint">{r.sentBy.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[12px] text-ink-faint mt-6">
        No passwords or API keys are stored by this tool. Expiry dates come from the public registry (RDAP) and a TLS handshake; provider billing is entered by hand.
      </p>
    </div>
  );
}

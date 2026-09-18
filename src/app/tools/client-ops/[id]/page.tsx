import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, Send, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CERT_ALARM_DAYS,
  CYCLE_LABELS,
  KIND_LABELS,
  canUseClientOps,
  daysLeft,
  draftReminder,
  inr,
  relativeDays,
  shortDate,
  statusOf,
} from "@/lib/client-ops/core";
import { markReminderSent, setSubscriptionActive, updateSubscription } from "../actions";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px] w-full";
const labelText = "text-[11px] font-bold text-ink-mute";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default async function SubscriptionDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseClientOps(session.user)) redirect("/dashboard");

  const { id } = await params;
  const subscription = await prisma.opsSubscription.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, email: true } },
      reminders: { orderBy: { sentAt: "desc" }, include: { sentBy: { select: { name: true } } } },
    },
  });
  if (!subscription) notFound();

  const left = daysLeft(subscription.expiresOn);
  const status = statusOf(subscription.expiresOn);
  const certLeft = subscription.sslExpiresOn ? daysLeft(subscription.sslExpiresOn) : null;
  const { subject, body } = draftReminder(subscription);
  const mailto = `mailto:${subscription.client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div>
      <Link href="/tools/client-ops" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-mute hover:text-ink transition">
        <ArrowLeft className="w-4 h-4" /> Client ops
      </Link>

      <div className="mt-3 mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">{subscription.client.name}</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">
          {KIND_LABELS[subscription.kind]} · {subscription.provider}
        </h1>
        <p className="text-ink-mute text-[14px] mt-1.5">
          Renews {shortDate(subscription.expiresOn)} ({relativeDays(left)}) · {CYCLE_LABELS[subscription.cycle]} · we charge{" "}
          <span className="font-bold text-ink">{inr(subscription.chargeAmount)}</span>, we pay {inr(subscription.costPaid)}
          {status === "expired" && <span className="ml-2 px-2 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-600 text-[11px] font-bold">expired</span>}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4 items-start">
        <div className="bg-card border border-border rounded-[20px] p-5 shadow-lift">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-brand-500" />
            <h2 className="font-display font-bold text-[15px]">Reminder email</h2>
          </div>
          <p className="text-[12px] text-ink-faint mb-3">
            To {subscription.client.email} · {subject}
          </p>
          <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed bg-page/70 border border-border rounded-2xl p-4">{body}</pre>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <form action={markReminderSent}>
              <input type="hidden" name="id" value={subscription.id} />
              <button type="submit" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold shadow-pop transition">
                <Send className="w-4 h-4" /> Mark reminder sent
              </button>
            </form>
            <a href={mailto} className="px-4 py-2 rounded-full border border-border text-[13px] font-bold text-ink-mute hover:text-ink hover:bg-muted transition">
              Open in mail
            </a>
            <span className="text-[12px] text-ink-faint">The tool sends nothing itself — this records that you did.</span>
          </div>

          <h3 className="font-display font-bold text-[14px] mt-6 mb-2">History</h3>
          {subscription.reminders.length === 0 ? (
            <p className="text-[13px] text-ink-mute">No reminders logged for this service yet.</p>
          ) : (
            <ul className="text-[13px] space-y-1.5">
              {subscription.reminders.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2">
                  <span className="text-ink-mute tabular-nums">{shortDate(r.sentAt)}</span>
                  <span className="text-ink-faint">— {r.sentBy.name ?? "someone"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-[20px] p-5 shadow-lift">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-accent-sky" />
              <h2 className="font-display font-bold text-[15px]">Auto-checks</h2>
            </div>
            <dl className="text-[13px] space-y-2">
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">Registry lookup</dt><dd className="font-semibold">{subscription.domain ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">Certificate host</dt><dd className="font-semibold">{subscription.sslHost ?? "—"}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-mute">Certificate expires</dt>
                <dd className="font-semibold">
                  {subscription.sslExpiresOn ? `${shortDate(subscription.sslExpiresOn)}${certLeft !== null && certLeft <= CERT_ALARM_DAYS ? " ⚠︎" : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">Last checked</dt><dd className="font-semibold">{subscription.checkedAt ? shortDate(subscription.checkedAt) : "never"}</dd></div>
            </dl>
            {subscription.checkNote && <p className="text-[12px] text-ink-faint leading-snug mt-3 pt-3 border-t border-border">{subscription.checkNote}</p>}
          </div>

          <form action={updateSubscription} className="bg-card border border-border rounded-[20px] p-5 shadow-lift grid gap-3">
            <h2 className="font-display font-bold text-[15px]">Edit service</h2>
            <input type="hidden" name="id" value={subscription.id} />
            <label className="grid gap-1"><span className={labelText}>Provider</span><input name="provider" defaultValue={subscription.provider} className={field} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1"><span className={labelText}>Renews on</span><input name="expiresOn" type="date" defaultValue={isoDay(subscription.expiresOn)} className={field} /></label>
              <label className="grid gap-1"><span className={labelText}>We charge (₹)</span><input name="chargeAmount" type="number" min="0" step="1" defaultValue={subscription.chargeAmount} className={field} /></label>
              <label className="grid gap-1"><span className={labelText}>We pay (₹)</span><input name="costPaid" type="number" min="0" step="1" defaultValue={subscription.costPaid ?? ""} className={field} /></label>
              <label className="grid gap-1"><span className={labelText}>Renewal link</span><input name="renewalLink" defaultValue={subscription.renewalLink ?? ""} className={field} /></label>
              <label className="grid gap-1"><span className={labelText}>Registry domain</span><input name="domain" defaultValue={subscription.domain ?? ""} className={field} /></label>
              <label className="grid gap-1"><span className={labelText}>Certificate host</span><input name="sslHost" defaultValue={subscription.sslHost ?? ""} className={field} /></label>
            </div>
            <label className="grid gap-1"><span className={labelText}>Notes</span><input name="notes" defaultValue={subscription.notes ?? ""} className={field} /></label>
            <button type="submit" className="justify-self-start px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Save</button>
          </form>

          <form action={setSubscriptionActive} className="text-right">
            <input type="hidden" name="id" value={subscription.id} />
            <input type="hidden" name="active" value={subscription.active ? "false" : "true"} />
            <button type="submit" className="text-[12.5px] font-semibold text-ink-faint hover:text-rose-600 transition">
              {subscription.active ? "Stop tracking this service" : "Track this service again"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

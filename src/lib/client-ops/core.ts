import type { Session } from "next-auth";
import type { BillingCycle, OpsClient, OpsSubscription, SubscriptionKind } from "@prisma/client";

/**
 * Access — internal active users, the same rule the rest of /tools uses. Kept in one
 * function so it can be tightened to a department or role later without hunting through
 * pages. Do NOT fall back to `!!user`.
 */
export function canUseClientOps(user: Session["user"] | undefined | null): boolean {
  return !!user && user.active === true;
}

export const KIND_LABELS: Record<SubscriptionKind, string> = {
  DOMAIN: "Domain",
  HOSTING: "Hosting",
  VERCEL: "Vercel",
  RAILWAY: "Railway",
  EMAIL: "Email",
  OTHER: "Other",
};

export const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: "Monthly", YEARLY: "Yearly" };

export const WINDOWS = [30, 60, 90] as const;
/** Certificates renew on their own ~90-day cycle, so they get a tighter alarm than billing. */
export const CERT_ALARM_DAYS = 15;

export type RenewalStatus = "expired" | "expiring" | "active";

const DAY = 86_400_000;
const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Days until a date; negative means already past. */
export function daysLeft(date: Date, now = new Date()): number {
  return Math.round((midnight(date) - midnight(now)) / DAY);
}

/** Derived on read, never stored — a stored status goes stale the day after you write it. */
export function statusOf(expiresOn: Date, now = new Date()): RenewalStatus {
  const d = daysLeft(expiresOn, now);
  return d < 0 ? "expired" : d <= 30 ? "expiring" : "active";
}

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const shortDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function relativeDays(d: number): string {
  if (d === 0) return "today";
  return d < 0 ? `${-d} day${d === -1 ? "" : "s"} ago` : `in ${d} day${d === 1 ? "" : "s"}`;
}

/** Yearly value of a subscription, so monthly and yearly lines can be compared. */
export const annualised = (s: Pick<OpsSubscription, "cycle" | "chargeAmount">) =>
  s.cycle === "YEARLY" ? s.chargeAmount : s.chargeAmount * 12;

export type SubscriptionWithClient = OpsSubscription & { client: Pick<OpsClient, "id" | "name" | "email"> };

/**
 * The reminder email. Preview and log only — the app sends nothing itself; the team copies
 * it into mail, or opens the prefilled mailto.
 */
export function draftReminder(s: SubscriptionWithClient, now = new Date()) {
  const left = daysLeft(s.expiresOn, now);
  const overdue = left < 0;
  const service = `${KIND_LABELS[s.kind].toLowerCase()} with ${s.provider}`;
  const subject = overdue
    ? `Overdue: ${s.provider} ${KIND_LABELS[s.kind].toLowerCase()} renewal for ${s.client.name}`
    : `Renewal due in ${left} days: ${s.provider} ${KIND_LABELS[s.kind].toLowerCase()} for ${s.client.name}`;
  const body = [
    `Hi ${s.client.name},`,
    "",
    overdue
      ? `Your ${service} expired on ${shortDate(s.expiresOn)}. We've kept the service on hold pending renewal.`
      : `Your ${service} is up for renewal on ${shortDate(s.expiresOn)} (${relativeDays(left)}).`,
    "",
    `Renewal amount: ${inr(s.chargeAmount)} (${CYCLE_LABELS[s.cycle].toLowerCase()})`,
    `Pay here: ${s.renewalLink || "<renewal link>"}`,
    "",
    "We'll handle the renewal with the provider once payment is confirmed. Reply here if anything looks off.",
    "",
    "— Indefine",
  ].join("\n");
  return { subject, body };
}

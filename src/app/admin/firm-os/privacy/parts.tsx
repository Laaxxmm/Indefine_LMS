// Shared bits for the privacy pages: status and due chips in the /agents chip style (parts.tsx:
// -50 fills with -800 text, AA on white), the back-to-admin link and the page header.
import Link from "next/link";
import type { RequestStatus } from "@/lib/privacy/policy";
import { chip, eyebrow, focusRing } from "@/app/agents/parts";

const STATUS_TONE: Record<RequestStatus, string> = {
  RECEIVED: "border-sky-200 bg-sky-50 text-sky-800",
  VERIFYING: "border-sky-200 bg-sky-50 text-sky-800",
  IN_PROGRESS: "border-brand-200 bg-brand-50 text-brand-700",
  ON_HOLD: "border-amber-300 bg-amber-100 text-amber-900",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-border bg-muted text-ink-soft",
};

export function RequestStatusChip({ status, label }: { status: RequestStatus; label: string }) {
  return <span className={`${chip} ${STATUS_TONE[status]}`}>{label}</span>;
}

export function OverdueChip() {
  return <span className={`${chip} border-rose-200 bg-rose-50 text-rose-700`}>Overdue</span>;
}

/** Due date in a list or fact line: red with an Overdue chip once past due. */
export function DueDate({ label, overdue, daysLeft }: { label: string; overdue: boolean; daysLeft: number | null }) {
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-red-700 tabular-nums">
        {label} <OverdueChip />
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {label}
      {daysLeft !== null && <span className="text-ink-mute"> · {daysLeft === 0 ? "due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span>}
    </span>
  );
}

/** The Firm OS admin page header: eyebrow, title, one line of context, back link. */
export function AdminHeader({ title, children, back = { href: "/admin", label: "← Admin" } }: { title: string; children?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
      <div>
        <p className={`${eyebrow} mb-1.5`}>Admin · Firm OS</p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">{title}</h1>
        {children && <p className="text-sm text-ink-mute mt-2">{children}</p>}
      </div>
      <Link
        href={back.href}
        className={`text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0 ${focusRing}`}
      >
        {back.label}
      </Link>
    </div>
  );
}

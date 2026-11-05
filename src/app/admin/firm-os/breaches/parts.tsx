// Shared bits for the breach pages: the notification-clock text (red once overdue), severity and
// status chips in the /agents chip style, and the runbook link.
import type { Clock } from "@/lib/privacy/breach";
import { BREACH_RUNBOOK_PATH, BREACH_RUNBOOK_URL, type BreachSeverity, type BreachStatus } from "@/lib/privacy/policy";
import { chip, linkText } from "@/app/agents/parts";

const CLOCK_TONE: Record<Clock["state"], string> = {
  done: "text-emerald-800",
  due: "text-ink",
  overdue: "text-red-700",
};

/** "41 hours left" / "Overdue by 5 hours" / "Done …", coloured by state. */
export function ClockValue({ clock, big = false }: { clock: Clock; big?: boolean }) {
  return (
    <p className={`${big ? "font-display text-[26px] font-extrabold leading-none" : "text-[13.5px] font-semibold"} tabular-nums ${CLOCK_TONE[clock.state]}`}>
      {big && clock.state !== "done" && clock.hoursLeft !== null ? (clock.state === "overdue" ? `${-clock.hoursLeft} h overdue` : `${clock.hoursLeft} h left`) : clock.text}
    </p>
  );
}

const SEVERITY_TONE: Record<BreachSeverity, string> = {
  low: "border-border bg-muted text-ink-soft",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-rose-200 bg-rose-50 text-rose-700",
};
const STATUS_TONE: Record<BreachStatus, string> = {
  OPEN: "border-rose-200 bg-rose-50 text-rose-700",
  CONTAINED: "border-amber-200 bg-amber-50 text-amber-800",
  NOTIFIED: "border-sky-200 bg-sky-50 text-sky-800",
  CLOSED: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function SeverityChip({ severity }: { severity: BreachSeverity }) {
  return <span className={`${chip} ${SEVERITY_TONE[severity]}`}>Severity: {severity}</span>;
}

export function BreachStatusChip({ status, label }: { status: BreachStatus; label: string }) {
  return <span className={`${chip} ${STATUS_TONE[status]}`}>{label}</span>;
}

export function RunbookLink() {
  return (
    <>
      Follow the breach runbook (
      <a href={BREACH_RUNBOOK_URL} target="_blank" rel="noopener noreferrer" className={linkText}>
        {BREACH_RUNBOOK_PATH}
      </a>
      ).
    </>
  );
}

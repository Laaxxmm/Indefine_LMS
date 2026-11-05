// Shared bits for the breach pages: the notification-clock text (red once overdue), severity and
// status chips (the shared Chip tones), and the runbook link.
import type { Clock } from "@/lib/privacy/breach";
import { BREACH_RUNBOOK_PATH, BREACH_RUNBOOK_URL, type BreachSeverity, type BreachStatus } from "@/lib/privacy/policy";
import { Chip } from "@/components/firm-os";
import { figure, linkText, type ChipTone } from "@/components/ui";

const CLOCK_TONE: Record<Clock["state"], string> = {
  done: "text-emerald-800",
  due: "text-ink",
  overdue: "text-rose-700",
};

/** "41 hours left" / "Overdue by 5 hours" / "Done …", coloured by state. */
export function ClockValue({ clock, big = false }: { clock: Clock; big?: boolean }) {
  return (
    <p className={`${big ? figure : "text-[13px] font-semibold tabular-nums"} ${CLOCK_TONE[clock.state]}`}>
      {big && clock.state !== "done" && clock.hoursLeft !== null ? (clock.state === "overdue" ? `${-clock.hoursLeft} h overdue` : `${clock.hoursLeft} h left`) : clock.text}
    </p>
  );
}

const SEVERITY_TONE: Record<BreachSeverity, ChipTone> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
};
const STATUS_TONE: Record<BreachStatus, ChipTone> = {
  OPEN: "danger",
  CONTAINED: "warning",
  NOTIFIED: "info",
  CLOSED: "success",
};

export function SeverityChip({ severity }: { severity: BreachSeverity }) {
  return <Chip tone={SEVERITY_TONE[severity]}>Severity: {severity}</Chip>;
}

export function BreachStatusChip({ status, label }: { status: BreachStatus; label: string }) {
  return <Chip tone={STATUS_TONE[status]}>{label}</Chip>;
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

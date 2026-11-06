// Shared bits for the privacy pages: status and due chips (the shared Chip tones: -50 fills with
// -800 text, AA on white) and the page header (the shared PageHeader with the way back to Admin).
import type { RequestStatus } from "@/lib/privacy/policy";
import { Chip, PageHeader } from "@/components/firm-os";
import type { ChipTone } from "@/components/ui";

const STATUS_TONE: Record<RequestStatus, ChipTone> = {
  RECEIVED: "info",
  VERIFYING: "info",
  IN_PROGRESS: "brand",
  ON_HOLD: "partner",
  COMPLETED: "success",
  REJECTED: "neutral",
};

export function RequestStatusChip({ status, label }: { status: RequestStatus; label: string }) {
  return <Chip tone={STATUS_TONE[status]}>{label}</Chip>;
}

export function OverdueChip() {
  return <Chip tone="danger">Overdue</Chip>;
}

/** Due date in a list or fact line: red with an Overdue chip once past due. */
export function DueDate({ label, overdue, daysLeft }: { label: string; overdue: boolean; daysLeft: number | null }) {
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-rose-700 tabular-nums">
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

/** The Firm OS admin page header: back link, eyebrow, title, one line of context. */
export function AdminHeader({ title, children, back = { href: "/admin", label: "Admin" } }: { title: string; children?: React.ReactNode; back?: { href: string; label: string } }) {
  return <PageHeader back={back} eyebrow="Admin · Firm OS" title={title} lead={children} />;
}

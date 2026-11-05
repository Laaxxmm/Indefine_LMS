// The one message box for errors, warnings, notes and confirmations on Firm OS pages (replaces the
// rose / amber boxes each page used to write by hand). An error is role="alert" (announced at once);
// the others are role="status" unless the caller says otherwise (role="note" for static guidance).
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export type AlertTone = "error" | "warning" | "info" | "success";

/** -50 fill, -200 border, -800 text (rose-700 for errors): each at least 5.7:1. */
const TONE: Record<AlertTone, { box: string; icon: typeof Info }> = {
  error: { box: "border-rose-200 bg-rose-50 text-rose-700", icon: XCircle },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-800", icon: AlertTriangle },
  info: { box: "border-sky-200 bg-sky-50 text-sky-800", icon: Info },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
};

export function Alert({
  tone = "info",
  title,
  role,
  id,
  className = "",
  children,
}: {
  tone?: AlertTone;
  /** A bold first line (what happened); the body says what to do. */
  title?: React.ReactNode;
  role?: "alert" | "status" | "note";
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div id={id} role={role ?? (tone === "error" ? "alert" : "status")} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px] leading-5 ${t.box} ${className}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-bold">{title}</p>}
        {children && (title ? <div className="mt-1">{children}</div> : children)}
      </div>
    </div>
  );
}

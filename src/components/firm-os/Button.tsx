// Buttons from the ui.ts variants, with a busy state: while busy the button shows a spinner (and
// the busy label, when given), is disabled so nothing is sent twice, and says aria-busy.
// buttonClass() styles a link the same way. One primary per screen.
import { Loader2 } from "lucide-react";
import { btnDanger, btnGhost, btnPrimary, btnSm, btnSuccess, btnWarn } from "@/components/ui";

export type ButtonVariant = "primary" | "secondary" | "success" | "warn" | "danger";

const VARIANT: Record<ButtonVariant, string> = { primary: btnPrimary, secondary: btnGhost, success: btnSuccess, warn: btnWarn, danger: btnDanger };

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" = "md", extra = ""): string {
  return `${VARIANT[variant]}${size === "sm" ? ` ${btnSm}` : ""}${extra ? ` ${extra}` : ""}`;
}

export function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin shrink-0`} aria-hidden="true" />;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  busyLabel,
  type = "button",
  disabled,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  busy?: boolean;
  /** What the button says while busy ("Saving…"); without it the label stays and the spinner shows. */
  busyLabel?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {busy && <Spinner className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

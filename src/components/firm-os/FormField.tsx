// One form field: label above, the control, then a hint and the error (role="alert"), each tied to
// the control by id. The caller passes the control with `id` and `aria-describedby={describedBy(…)}`.
import { errorText, hintText, labelText } from "@/components/ui";

/** The aria-describedby value for a field's hint and error (undefined when neither is shown). */
export function describedBy(id: string, hint?: React.ReactNode, error?: React.ReactNode): string | undefined {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  className = "",
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Adds "(required)" to the label; the control keeps its own `required`. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className={labelText}>
        {label}
        {required && <span className="font-normal text-ink-mute"> (required)</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={hintText}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

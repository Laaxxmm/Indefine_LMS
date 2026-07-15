"use client";

// Submit button that asks for confirmation first. stopPropagation so it can sit
// inside a <summary> without toggling the surrounding <details>.
export function ConfirmButton({
  message,
  className,
  title,
  children,
}: {
  message: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

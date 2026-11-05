// What a list or panel says when there is nothing in it: a short title, one sentence on when
// something will appear, and an optional next step.
export function EmptyState({ title, action, children }: { title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card border border-dashed border-border px-6 py-10 text-center">
      <p className="text-[15px] leading-6 font-semibold">{title}</p>
      {children && <p className="text-[13px] leading-5 text-ink-mute mt-1 max-w-xl mx-auto">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

import { STEP_ORDER, STEP_META, type WizardStep } from "@/lib/wizard";

export default function WizardProgress({ active }: { active: WizardStep }) {
  const currentIdx = STEP_META[active].idx;
  const visible = STEP_ORDER.filter((s) => s !== "intro");
  const total = visible.length;
  const pct = Math.min(100, ((currentIdx) / total) * 100);

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between text-xs text-ink-mute mb-2">
        <span className="font-semibold text-ink">
          Step {currentIdx} of {total}
        </span>
        <span>{STEP_META[active].label}</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-accent-violet rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-3">
        {visible.map((s) => {
          const meta = STEP_META[s];
          const reached = currentIdx >= meta.idx;
          const current = active === s;
          return (
            <div
              key={s}
              className={`text-[10px] uppercase tracking-wider font-semibold transition ${
                current
                  ? "text-brand-600"
                  : reached
                    ? "text-ink-soft"
                    : "text-ink-faint"
              }`}
            >
              {meta.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

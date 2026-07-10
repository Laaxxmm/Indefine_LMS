// Shared approvals UI — rendered by /admin/approvals and /team/approvals.
// Server component; forms post to the shared manager-or-admin actions.

import {
  Check,
  X,
  Sparkles,
  Target,
  Rocket,
  CircleDollarSign,
} from "lucide-react";
import {
  approveQuest,
  rejectQuest,
  fundInitiative,
  archiveInitiative,
} from "@/lib/approval-actions";

export interface QuestItem {
  id: string;
  title: string;
  why: string | null;
  user: { name: string | null; email: string };
  cycle: { name: string };
  milestones: { id: string; quarter: number; title: string }[];
}

export interface InitiativeItem {
  id: string;
  title: string;
  description: string | null;
  impact: string | null;
  user: { name: string | null; email: string };
  cycle: { name: string };
}

export function ApprovalsBoard({
  quests,
  initiatives,
}: {
  quests: QuestItem[];
  initiatives: InitiativeItem[];
}) {
  return (
    <>
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-emerald-600" />
          <h2 className="font-display font-bold">
            Pending quests{" "}
            <span className="text-ink-faint font-normal text-sm">
              ({quests.length})
            </span>
          </h2>
        </div>
        {quests.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-8 text-center text-ink-mute text-sm shadow-soft">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-ink-faint" />
            All caught up — no quests need approval.
          </div>
        ) : (
          <div className="space-y-3">
            {quests.map((q) => (
              <div
                key={q.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase tracking-wider font-bold text-ink-faint">
                      {q.user.name ?? q.user.email} · {q.cycle.name}
                    </p>
                    <h3 className="font-display font-bold text-lg mt-0.5">
                      {q.title}
                    </h3>
                    {q.why && (
                      <p className="text-xs text-ink-mute italic mt-1">
                        Because: {q.why}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <form action={rejectQuest}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft inline-flex items-center gap-1.5 text-ink-mute transition">
                        <X className="w-3.5 h-3.5" />
                        Send back
                      </button>
                    </form>
                    <form action={approveQuest}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium inline-flex items-center gap-1.5 shadow-pop transition">
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    </form>
                  </div>
                </div>
                {q.milestones.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 pt-3 border-t border-border">
                    {q.milestones.map((m) => (
                      <div key={m.id} className="text-xs flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-[10px]">
                          Q{m.quarter}
                        </span>
                        <span className="text-ink-soft truncate">{m.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="w-4 h-4 text-rose-600" />
          <h2 className="font-display font-bold">
            Initiatives waiting for funding{" "}
            <span className="text-ink-faint font-normal text-sm">
              ({initiatives.length})
            </span>
          </h2>
        </div>
        {initiatives.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-8 text-center text-ink-mute text-sm shadow-soft">
            No new initiatives pitched.
          </div>
        ) : (
          <div className="space-y-3">
            {initiatives.map((i) => (
              <div
                key={i.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wider font-bold text-ink-faint">
                      {i.user.name ?? i.user.email} · {i.cycle.name}
                    </p>
                    <h3 className="font-display font-bold text-lg mt-0.5">
                      {i.title}
                    </h3>
                    {i.description && (
                      <p className="text-sm text-ink-soft mt-1">{i.description}</p>
                    )}
                    {i.impact && (
                      <p className="text-xs text-ink-mute italic mt-2">
                        Impact: {i.impact}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <form action={archiveInitiative}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft inline-flex items-center gap-1.5 text-ink-mute transition">
                        <X className="w-3.5 h-3.5" />
                        Archive
                      </button>
                    </form>
                    <form action={fundInitiative}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-medium inline-flex items-center gap-1.5 shadow-pop transition">
                        <CircleDollarSign className="w-3.5 h-3.5" />
                        Fund it
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

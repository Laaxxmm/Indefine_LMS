import { redirect } from "next/navigation";
import { currentActor } from "@/lib/work/actor";
import { PICK_CAP, PLAN_CAP } from "@/lib/work/core";
import { gateState, pickCandidates, planCandidates, todayPicks } from "@/lib/work/db";
import { CaptureBox } from "./CaptureBox";
import { PlanForm } from "./PlanForm";
import { PickForm } from "./PickForm";
import { TodayList } from "./TodayList";

export const dynamic = "force-dynamic";

function Shell({ kicker, title, sub, children }: { kicker: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[720px] mx-auto">
      <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">{kicker}</p>
      <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">{title}</h1>
      <p className="text-ink-mute text-[15px] mt-1.5 mb-6">{sub}</p>
      {children}
      <div className="mt-8">
        <CaptureBox />
      </div>
    </div>
  );
}

// The gate: no week plan → plan; no pick today (and something to pick) → pick; else Today.
export default async function TodayPage() {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const kicker = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const gate = await gateState(actor.id, now);

  if (gate.step === "plan") {
    const works = await planCandidates(actor);
    return (
      <Shell kicker={kicker} title="Pick this week's work" sub={`Up to ${PLAN_CAP}. Everything else waits until next Monday.`}>
        <PlanForm works={works.map((w) => ({ id: w.id, title: w.title, status: w.status, owner: w.owner.name ?? w.owner.email }))} selected={[]} cap={PLAN_CAP} />
      </Shell>
    );
  }

  if (gate.step === "pick") {
    const { groups, precheck } = await pickCandidates(actor.id, now);
    return (
      <Shell kicker={kicker} title="Pick today" sub={`Up to ${PICK_CAP} tasks. A pick is a promise, it cannot be taken back.`}>
        <PickForm groups={groups} precheck={precheck} remaining={PICK_CAP} />
      </Shell>
    );
  }

  const picks = await todayPicks(actor.id, now);
  const remaining = PICK_CAP - picks.length;
  const more = !gate.weekend && remaining > 0 && gate.hasOpenTasks ? await pickCandidates(actor.id, now) : null;

  let title = "Today";
  let sub = "Tick what you finish. Unfinished picks carry to tomorrow.";
  if (gate.weekend) {
    title = "Weekend, nothing promised";
    sub = "Capture ideas if they come. The gate returns on Monday.";
  } else if (!gate.hasOpenTasks) {
    title = "Nothing assigned yet";
    sub = "Ask the lead for a task, or capture an idea below.";
  } else if (picks.length === 0) {
    title = "No open tasks in your plan";
    sub = "Add tasks on the board, or change the plan on the Week page.";
  }

  return (
    <Shell kicker={kicker} title={title} sub={sub}>
      {picks.length > 0 && (
        <TodayList
          picks={picks.map((p) => ({
            taskId: p.taskId,
            title: p.task.title,
            status: p.task.status,
            outcome: p.outcome,
            workId: p.task.work.id,
            workTitle: p.task.work.title,
          }))}
        />
      )}
      {more && more.groups.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-bold text-brand-600">Pick another ({remaining} left)</summary>
          <div className="mt-3">
            <PickForm groups={more.groups} precheck={[]} remaining={remaining} />
          </div>
        </details>
      )}
    </Shell>
  );
}

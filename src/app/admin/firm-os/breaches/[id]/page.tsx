import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { card } from "@/components/ui";
import { BackLink, eyebrow, pageTitle, sectionTitle } from "@/app/agents/parts";
import { prisma } from "@/lib/prisma";
import { istLocalInputValue } from "@/lib/ist";
import { getBreach } from "@/lib/privacy/breach";
import { BreachActions } from "../BreachForms";
import { BreachStatusChip, ClockValue, RunbookLink, SeverityChip } from "../parts";

export const dynamic = "force-dynamic";

// Firm OS · one breach: the two notice clocks with their basis and what legal must verify, the
// next step (containment, notices, update, close) and the recorded timeline.

export default async function BreachPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const { id } = await params;
  const now = new Date();
  const b = await getBreach(prisma, id, now);
  if (!b) notFound();
  const clocks = [
    { title: "Board report", clock: b.board },
    { title: "Affected people", clock: b.principals },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <BackLink href="/admin/firm-os/breaches">Breach register</BackLink>
      <div className="mb-6">
        <p className={eyebrow}>Admin · Firm OS · Breach</p>
        <h1 className={pageTitle}>Data breach</h1>
        <p className="mt-2 text-[13.5px] break-words whitespace-pre-wrap max-w-3xl">{b.summary}</p>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-sm text-ink-mute">
          <BreachStatusChip status={b.status} label={b.statusLabel} />
          <SeverityChip severity={b.severity} />
          <span className="tabular-nums">Became aware {b.detectedLabel}</span>
          <span className="tabular-nums">· {b.affectedCount === null ? "people affected not known yet" : `${b.affectedCount.toLocaleString("en-IN")} people affected`}</span>
        </div>
        <p className="text-sm text-ink-mute mt-2">
          <RunbookLink />
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {clocks.map(({ title, clock }) => (
          <div key={title} className={`${card} ${clock.state === "overdue" ? "border-rose-200" : ""}`}>
            <p className={sectionTitle}>{title}</p>
            <ClockValue clock={clock} big />
            <p className="text-[11.5px] text-ink-mute mt-1 tabular-nums">Due {clock.dueLabel}</p>
            <p className="text-[12px] text-ink-soft mt-3">{clock.basis}</p>
            <p className="text-[12px] text-amber-800 mt-1">{clock.verify}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <section className={`${card} lg:col-span-2 min-w-0`} aria-labelledby="next-step">
          <h2 id="next-step" className={sectionTitle}>
            Next step
          </h2>
          {b.status === "CLOSED" ? (
            <p className="text-sm text-ink-mute">This incident is closed. Record a new incident if something more has happened.</p>
          ) : (
            <BreachActions
              id={b.id}
              nowLocal={istLocalInputValue(now)}
              boardDone={b.board.state === "done"}
              principalsDone={b.principals.state === "done"}
              severity={b.severity}
              affectedCount={b.affectedCount}
            />
          )}
        </section>
        <section className={`${card} min-w-0`} aria-labelledby="timeline">
          <h2 id="timeline" className={sectionTitle}>
            Timeline
          </h2>
          <ol className="space-y-3">
            {b.timeline.map((e) => (
              <li key={e.id} className="text-[13px]">
                <p className="text-[11.5px] text-ink-mute tabular-nums">
                  {e.actorName} · {e.atLabel} IST
                </p>
                <p className="font-semibold">{e.label}</p>
                {e.detail && <p className="text-ink-soft whitespace-pre-wrap">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

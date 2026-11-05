import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { card } from "@/components/ui";
import { EmptyState, eyebrow, pageTitle, sectionTitle, StateChip, tableWrap, td, th, thead } from "@/app/agents/parts";
import { calendarFromEnv } from "@/lib/agents/coach/config";
import { coachDb } from "@/lib/agents/coach/defaults";
import { isBreakNudgeEnabled } from "@/lib/agents/coach/flags";
import { loadCoachPage, type SummaryView } from "@/lib/agents/coach/views";
import { formatDate } from "@/lib/agents/core/format";
import { CoachSettings } from "./CoachSettings";
import { NoticeList } from "./NoticeList";
import { BoardTable, JobLink, summaryFigures } from "./parts";

export const dynamic = "force-dynamic";

function More({ n, what }: { n: number; what: (n: number) => string }) {
  if (n === 0) return null;
  return (
    <p className="text-[13px] text-ink-mute mt-2">
      {n} more {what(n)}, listed under Everything else.
    </p>
  );
}

/** The person's own summary: the cycle-time page's figure tiles (label in sectionTitle, 26px value). */
function MySummary({ s }: { s: SummaryView }) {
  return (
    <>
      <p className="text-[13.5px]">{s.message}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
        {summaryFigures(s).map((f) => (
          <div key={f.label}>
            <dt className={sectionTitle}>{f.label}</dt>
            <dd className="font-display text-[26px] font-extrabold tabular-nums leading-none">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-ink-mute mt-4 tabular-nums">Prepared {s.at}. Visible to you and your manager.</p>
    </>
  );
}

// Firm OS · My day: the person's open jobs in the order to take them (rank.ts), their notices, their
// weekly summary, their direct reports' summaries (managers), and their own reminder settings.
export default async function CoachPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const now = new Date();
  const data = await loadCoachPage(coachDb(), session.user, now, { calendar: calendarFromEnv() });
  const { board } = data;
  const shown = new Set([...board.mustToday, ...board.thisWeek].map((r) => r.id));
  const rest = board.all.filter((r) => !shown.has(r.id));

  return (
    <div>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS</p>
        <h1 className={pageTitle}>My day</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Your open jobs in the order to take them: anything past due first, then by how near the statutory and internal dates are, the client, whether someone is
          waiting on you, and the late-fee exposure of the service.
        </p>
      </div>

      {data.notices.length > 0 && (
        <section aria-labelledby="notices" className={`${card} mb-8`}>
          <h2 id="notices" className={sectionTitle}>
            Notices
          </h2>
          <NoticeList notices={data.notices} />
        </section>
      )}

      <section aria-labelledby="must-today" className="mb-8">
        <h2 id="must-today" className={sectionTitle}>
          Must today
        </h2>
        {board.mustToday.length === 0 ? (
          <EmptyState title="Nothing must be done today">Jobs past due, due internally today, or due statutorily by the next working day appear here.</EmptyState>
        ) : (
          <BoardTable items={board.mustToday} caption="Must today, in the order to take them" />
        )}
        <More n={board.mustTodayMore} what={() => "must be done today"} />
      </section>

      <section aria-labelledby="this-week" className="mb-8">
        <h2 id="this-week" className={sectionTitle}>
          This week
        </h2>
        {board.thisWeek.length === 0 ? (
          <EmptyState title="Nothing else due this week">Jobs due within the next five working days appear here.</EmptyState>
        ) : (
          <BoardTable items={board.thisWeek} caption="Due within the next five working days, in the order to take them" />
        )}
        <More n={board.thisWeekMore} what={(k) => (k === 1 ? "is due this week" : "are due this week")} />
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="everything-else" className="mb-8">
          <h2 id="everything-else" className={sectionTitle}>
            Everything else
          </h2>
          <BoardTable items={rest} caption="Your other open jobs, in the order to take them" />
        </section>
      )}

      {board.filed.length > 0 && (
        <section aria-labelledby="filed" className="mb-8">
          <h2 id="filed" className={sectionTitle}>
            Filed, waiting to close
          </h2>
          <p className="text-[13px] text-ink-mute mb-3">The job is done once the Final file is in SharePoint and the Turia task is closed with time logged.</p>
          <div className={tableWrap}>
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Jobs you filed that are waiting for the close gate</caption>
              <thead className={thead}>
                <tr>
                  <th scope="col" className={th}>Job</th>
                  <th scope="col" className={th}>Client</th>
                  <th scope="col" className={th}>Period</th>
                  <th scope="col" className={th}>Job state</th>
                  <th scope="col" className={`${th} text-right`}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.filed.map((j) => (
                  <tr key={j.id} className="border-t border-border hover:bg-muted/40 h-11">
                    <td className={`${td} font-semibold`}>{j.title}</td>
                    <td className={`${td} font-semibold`}>{j.clientCode}</td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>
                      {j.period} · FY {j.fy}
                    </td>
                    <td className={td}>
                      <StateChip state={j.state} />
                    </td>
                    <td className={`${td} text-right`}>
                      <JobLink item={j} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="your-week" className={data.mySummary ? `${card} mb-8` : "mb-8"}>
        <h2 id="your-week" className={sectionTitle}>
          Your week
        </h2>
        {data.mySummary ? (
          <MySummary s={data.mySummary} />
        ) : (
          <EmptyState title="No summary yet">Each Friday at 16:00 IST a short summary of your week appears here: jobs done, time from assignment to done, and the longest stage.</EmptyState>
        )}
      </section>

      {data.team.length > 0 && (
        <section aria-labelledby="team-week" className="mb-8">
          <h2 id="team-week" className={sectionTitle}>
            Your team&apos;s week
          </h2>
          <p className="text-[13px] text-ink-mute mb-3">Weekly summaries of the people who report to you. Reminders and break settings stay private to each person.</p>
          <div className={tableWrap}>
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Latest weekly summary of each person who reports to you</caption>
              <thead className={thead}>
                <tr>
                  <th scope="col" className={th}>Person</th>
                  <th scope="col" className={th}>Week of</th>
                  <th scope="col" className={`${th} text-right`}>Jobs done</th>
                  <th scope="col" className={`${th} text-right`}>Median, assigned to done</th>
                  <th scope="col" className={th}>Longest stage</th>
                  <th scope="col" className={`${th} text-right`}>Open</th>
                  <th scope="col" className={`${th} text-right`}>Past internal due</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((t) => {
                  const f = t.summary ? summaryFigures(t.summary) : null;
                  return (
                    <tr key={t.userId} className="border-t border-border hover:bg-muted/40 h-11">
                      <td className={`${td} font-semibold`}>{t.name}</td>
                      {t.summary && f ? (
                        <>
                          <td className={`${td} tabular-nums whitespace-nowrap`}>{formatDate(t.summary.weekOf)}</td>
                          <td className={`${td} text-right tabular-nums`}>{f[0].value}</td>
                          <td className={`${td} text-right tabular-nums`}>{f[1].value}</td>
                          <td className={td}>{f[2].value}</td>
                          <td className={`${td} text-right tabular-nums`}>{f[3].value}</td>
                          <td className={`${td} text-right tabular-nums`}>{f[4].value}</td>
                        </>
                      ) : (
                        <td className={`${td} text-ink-mute`} colSpan={6}>
                          No summary in the last two weeks.
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className={sectionTitle}>
          Reminders and breaks
        </h2>
        <CoachSettings prefs={data.prefs} breakFeature={isBreakNudgeEnabled()} />
      </section>
    </div>
  );
}

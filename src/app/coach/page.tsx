import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { figure, sectionTitle, td, tdNum, tr } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, Section, StateChip } from "@/components/firm-os";
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

/** The person's own summary: the cycle-time page's figure tiles (label in sectionTitle, the shared figure type). */
function MySummary({ s }: { s: SummaryView }) {
  return (
    <>
      <p className="text-[13px]">{s.message}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
        {summaryFigures(s).map((f) => (
          <div key={f.label}>
            <dt className={sectionTitle}>{f.label}</dt>
            <dd className={figure}>{f.value}</dd>
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
      <PageHeader
        eyebrow="Firm OS"
        title="My day"
        lead="Your open jobs in the order to take them: anything past due first, then by how near the statutory and internal dates are, the client, whether someone is waiting on you, and the late-fee exposure of the service."
      />

      {data.notices.length > 0 && (
        <Section id="notices" title="Notices" card>
          <NoticeList notices={data.notices} />
        </Section>
      )}

      <Section id="must-today" title="Must today">
        {board.mustToday.length === 0 ? (
          <EmptyState title="Nothing must be done today">Jobs past due, due internally today, or due statutorily by the next working day appear here.</EmptyState>
        ) : (
          <BoardTable items={board.mustToday} caption="Must today, in the order to take them" />
        )}
        <More n={board.mustTodayMore} what={() => "must be done today"} />
      </Section>

      <Section id="this-week" title="This week">
        {board.thisWeek.length === 0 ? (
          <EmptyState title="Nothing else due this week">Jobs due within the next five working days appear here.</EmptyState>
        ) : (
          <BoardTable items={board.thisWeek} caption="Due within the next five working days, in the order to take them" />
        )}
        <More n={board.thisWeekMore} what={(k) => (k === 1 ? "is due this week" : "are due this week")} />
      </Section>

      {rest.length > 0 && (
        <Section id="everything-else" title="Everything else">
          <BoardTable items={rest} caption="Your other open jobs, in the order to take them" />
        </Section>
      )}

      {board.filed.length > 0 && (
        <Section id="filed" title="Filed, waiting to close">
          <p className="text-[13px] text-ink-mute mb-3">The job is done once the Final file is in SharePoint and the Turia task is closed with time logged.</p>
          <DataTable
            caption="Jobs you filed that are waiting for the close gate"
            columns={[{ label: "Job" }, { label: "Client" }, { label: "Period" }, { label: "Job state" }, { label: "Action", align: "right", srOnly: true }]}
          >
            {board.filed.map((j) => (
              <tr key={j.id} className={tr}>
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
          </DataTable>
        </Section>
      )}

      <Section id="your-week" title="Your week" card={!!data.mySummary}>
        {data.mySummary ? (
          <MySummary s={data.mySummary} />
        ) : (
          <EmptyState title="No summary yet">Each Friday at 16:00 IST a short summary of your week appears here: jobs done, time from assignment to done, and the longest stage.</EmptyState>
        )}
      </Section>

      {data.team.length > 0 && (
        <Section id="team-week" title="Your team's week">
          <p className="text-[13px] text-ink-mute mb-3">Weekly summaries of the people who report to you. Reminders and break settings stay private to each person.</p>
          <DataTable
            caption="Latest weekly summary of each person who reports to you"
            columns={[{ label: "Person" }, { label: "Week of" }, { label: "Jobs done", align: "right" }, { label: "Median, assigned to done", align: "right" }, { label: "Longest stage" }, { label: "Open", align: "right" }, { label: "Past internal due", align: "right" }]}
          >
            {data.team.map((t) => {
              const f = t.summary ? summaryFigures(t.summary) : null;
              return (
                <tr key={t.userId} className={tr}>
                  <td className={`${td} font-semibold`}>{t.name}</td>
                  {t.summary && f ? (
                    <>
                      <td className={`${td} tabular-nums whitespace-nowrap`}>{formatDate(t.summary.weekOf)}</td>
                      <td className={tdNum}>{f[0].value}</td>
                      <td className={tdNum}>{f[1].value}</td>
                      <td className={td}>{f[2].value}</td>
                      <td className={tdNum}>{f[3].value}</td>
                      <td className={tdNum}>{f[4].value}</td>
                    </>
                  ) : (
                    <td className={`${td} text-ink-mute`} colSpan={6}>
                      No summary in the last two weeks.
                    </td>
                  )}
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}

      <Section id="settings" title="Reminders and breaks" card last>
        <CoachSettings prefs={data.prefs} breakFeature={isBreakNudgeEnabled()} />
      </Section>
    </div>
  );
}

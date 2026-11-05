// "Firm OS jobs" on /clients/[id] (FIRM_OS_CL_PATHS on and a FirmClient exists): the client's
// JobTasks, read-only, scoped as /agents is. Each row links to its latest agent run, or to /agents
// when no agent has run on it yet. Laid out like the page's Jobs card (card, h2, compact table);
// headings use the Firm OS ink-mute (AA on white) where the LMS card uses ink-faint.
import Link from "next/link";
import { card } from "@/components/ui";
import type { ClientJobRow } from "@/lib/agents/client-jobs";
import { StateChip, linkText, runsListLabel, sectionTitle } from "@/app/agents/parts";

const th = "py-2 pr-3 font-bold";
const td = "py-2 pr-3";

export function FirmOsJobs({ jobs, seesAll }: { jobs: ClientJobRow[]; seesAll: boolean }) {
  const agentsLabel = runsListLabel(seesAll);
  return (
    <section aria-labelledby="firm-os-jobs" className={`${card} mb-6`}>
      <h2 id="firm-os-jobs" className={sectionTitle}>
        Firm OS jobs ({jobs.length})
      </h2>
      {jobs.length === 0 ? (
        <p className="text-[13px] text-ink-mute">{seesAll ? "No Firm OS jobs for this client yet." : "No Firm OS jobs for this client that you prepare or review."}</p>
      ) : (
        <>
          <p className="text-[13px] text-ink-mute mb-3">Read-only here. Open a job&apos;s agent run to work on it.</p>
          <div className="relative overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Firm OS jobs for this client: open jobs soonest internal due first, then done jobs</caption>
              <thead className="text-[11px] uppercase tracking-wide text-ink-mute text-left">
                <tr>
                  <th scope="col" className={th}>Service</th>
                  <th scope="col" className={th}>Period</th>
                  <th scope="col" className={th}>Job</th>
                  <th scope="col" className={th}>Job state</th>
                  <th scope="col" className={th}>Internal due</th>
                  <th scope="col" className={th}>Assignee</th>
                  <th scope="col" className={th}>Agent run</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className={`${td} font-semibold`}>{j.service}</td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>
                      {j.period} · FY {j.fy}
                    </td>
                    <td className={td}>{j.title}</td>
                    <td className={td}>
                      <StateChip state={j.state} />
                    </td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{j.internalDue}</td>
                    <td className={`${td} whitespace-nowrap`}>{j.assignee}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {j.run ? (
                        <>
                          <Link href={j.run.href} className={linkText} aria-label={`Open run for ${j.title} ${j.period}`}>
                            Open run
                          </Link>
                          <span className="ml-2 text-[11.5px] text-ink-mute">attempt {j.run.attempt}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-ink-mute">No run yet · </span>
                          <Link href="/agents" className={linkText} aria-label={`${agentsLabel}: no run yet for ${j.title} ${j.period}`}>
                            {agentsLabel}
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

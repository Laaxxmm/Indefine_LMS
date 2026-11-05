import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { card } from "@/components/ui";
import { linkText, sectionTitle } from "@/app/agents/parts";
import { prisma } from "@/lib/prisma";
import { istLocalInputValue } from "@/lib/ist";
import { listBreaches } from "@/lib/privacy/breach";
import { BREACH_CLOCKS } from "@/lib/privacy/policy";
import { AdminHeader } from "../privacy/parts";
import { NewBreachForm } from "./BreachForms";
import { BreachStatusChip, ClockValue, RunbookLink, SeverityChip } from "./parts";

export const dynamic = "force-dynamic";

// Firm OS · breach register: personal data breaches with their notification clocks — the Data
// Protection Board report (72 hours from becoming aware, DPDP Rules 2025, legal to verify) and
// notices to affected people. Open incidents get a tile with hours remaining; overdue is red.

const headCell = "font-semibold py-2.5";
/** A long summary cut at a word for a link; the full text is on the incident page. */
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

export default async function BreachRegisterPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const now = new Date();
  const rows = await listBreaches(prisma, now);
  const open = rows.filter((r) => r.status !== "CLOSED");
  const boardOverdue = open.filter((r) => r.board.state === "overdue").length;
  const peopleOverdue = open.filter((r) => r.principals.state === "overdue").length;

  const stats = [
    { label: "Open incidents", value: String(open.length), alert: false },
    { label: "Board reports overdue", value: String(boardOverdue), alert: boardOverdue > 0 },
    { label: "Notices to people overdue", value: String(peopleOverdue), alert: peopleOverdue > 0 },
    { label: "Incidents recorded", value: String(rows.length), alert: false },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <AdminHeader title="Breach register">
        Personal data breaches and their notice clocks, counted from when the firm became aware. <RunbookLink />
      </AdminHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={sectionTitle}>{s.label}</p>
            <p className={`font-display text-[26px] font-extrabold tabular-nums leading-none ${s.alert ? "text-red-700" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {open.length > 0 && (
        <section aria-labelledby="clocks" className="mb-6">
          <h2 id="clocks" className={sectionTitle}>
            Notice clocks of open incidents
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {open.map((r) => (
              <div key={r.id} className={`${card} ${r.board.state === "overdue" || r.principals.state === "overdue" ? "border-rose-200" : ""}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <Link href={`/admin/firm-os/breaches/${encodeURIComponent(r.id)}`} className={`${linkText} min-w-0 break-words`}>
                    {short(r.summary, 120)}
                  </Link>
                  <SeverityChip severity={r.severity} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className={sectionTitle}>Board report</p>
                    <ClockValue clock={r.board} big />
                    <p className="text-[11.5px] text-ink-mute mt-1 tabular-nums">Due {r.board.dueLabel}</p>
                  </div>
                  <div>
                    <p className={sectionTitle}>Affected people</p>
                    <ClockValue clock={r.principals} big />
                    <p className="text-[11.5px] text-ink-mute mt-1 tabular-nums">Target {r.principals.dueLabel}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-amber-800 mt-2">{BREACH_CLOCKS.board.verify}</p>
        </section>
      )}

      <section className={`${card} mb-6`} aria-labelledby="new-breach">
        <h2 id="new-breach" className={sectionTitle}>
          Record an incident
        </h2>
        <NewBreachForm nowLocal={istLocalInputValue(now)} />
      </section>

      <section className={`${card} min-w-0`}>
        <h2 className={sectionTitle}>All incidents, newest first</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-mute">No breaches recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-mute">
                <tr className="border-b border-border">
                  <th scope="col" className={`text-left ${headCell} pr-3`}>Incident</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Became aware</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Status</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Board report</th>
                  <th scope="col" className={`text-left ${headCell} pl-3`}>Affected people</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 h-11">
                    <td className="pr-3">
                      <Link href={`/admin/firm-os/breaches/${encodeURIComponent(r.id)}`} className={linkText}>
                        {short(r.summary, 80)}
                      </Link>
                    </td>
                    <td className="px-3 tabular-nums whitespace-nowrap">{r.detectedLabel}</td>
                    <td className="px-3">
                      <BreachStatusChip status={r.status} label={r.statusLabel} />
                    </td>
                    <td className="px-3 whitespace-nowrap">
                      <ClockValue clock={r.board} />
                    </td>
                    <td className="pl-3 whitespace-nowrap">
                      <ClockValue clock={r.principals} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

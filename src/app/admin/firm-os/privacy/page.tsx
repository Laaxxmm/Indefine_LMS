import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { card } from "@/components/ui";
import { focusRing, linkText, sectionTitle } from "@/app/agents/parts";
import { prisma } from "@/lib/prisma";
import { istDayKey } from "@/lib/ist";
import { listRequests } from "@/lib/privacy/register";
import { KIND_LABELS, OUTER_LIMIT_DAYS, REQUEST_KINDS, REQUEST_STATUSES, STATUS_LABELS } from "@/lib/privacy/policy";
import { NewRequestForm } from "./PrivacyForms";
import { AdminHeader, DueDate, RequestStatusChip } from "./parts";

export const dynamic = "force-dynamic";

// Firm OS · privacy requests: the DPDP Act 2023 register of data-principal requests (access,
// correction, erasure, grievance, nomination, consent withdrawal) with their due dates. Admins
// work it here; the steps of each request are on its own page. Identifiers are never shown raw.

const headCell = "font-semibold py-2.5";
const control = `bg-white border border-border rounded-lg px-3 py-2 ${focusRing}`;

export default async function PrivacyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const now = new Date();
  const filters = { status: sp.status ?? "", kind: sp.kind ?? "", overdue: sp.overdue === "1" };
  const { rows, counts } = await listRequests(prisma, filters, now);
  const kinds = REQUEST_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));

  const stats = [
    { label: "Open", value: counts.open, alert: false },
    { label: "Overdue", value: counts.overdue, alert: counts.overdue > 0 },
    { label: "Due within 7 days", value: counts.dueSoon, alert: false },
    { label: "On legal hold", value: counts.onHold, alert: false },
  ];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <AdminHeader title="Privacy requests">
        Requests from clients, their contacts and staff under the DPDP Act 2023. Reply targets are firm policy (outer limit {OUTER_LIMIT_DAYS} days); a partner or
        lawyer is to verify them against the DPDP Rules 2025.
      </AdminHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={card}>
            <p className={sectionTitle}>{s.label}</p>
            <p className={`font-display text-[26px] font-extrabold tabular-nums leading-none ${s.alert ? "text-red-700" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <section className={`${card} mb-6`} aria-labelledby="new-request">
        <h2 id="new-request" className={sectionTitle}>
          Log a request
        </h2>
        <NewRequestForm kinds={kinds} today={istDayKey(now)} />
      </section>

      <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`}>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">Status</span>
          <select name="status" defaultValue={filters.status} className={control}>
            <option value="">All</option>
            <option value="open">Open (not closed)</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">Kind</span>
          <select name="kind" defaultValue={filters.kind} className={control}>
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm inline-flex items-center gap-2 pb-2">
          <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} className={`h-4 w-4 rounded border-border ${focusRing}`} />
          Overdue only
        </label>
        <button className={`px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold ${focusRing}`}>Apply</button>
      </form>

      <section className={`${card} min-w-0`}>
        <h2 className={sectionTitle}>Requests, earliest due first</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-mute">No privacy requests match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-mute">
                <tr className="border-b border-border">
                  <th scope="col" className={`text-left ${headCell} pr-3`}>Request</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Person</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Status</th>
                  <th scope="col" className={`text-left ${headCell} px-3`}>Received</th>
                  <th scope="col" className={`text-left ${headCell} pl-3`}>Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 h-11">
                    <td className="pr-3">
                      <Link href={`/admin/firm-os/privacy/${encodeURIComponent(r.id)}`} className={linkText}>
                        {r.kindLabel}
                      </Link>
                    </td>
                    <td className="px-3 break-words">{r.principalLabel}</td>
                    <td className="px-3">
                      <RequestStatusChip status={r.status} label={r.statusLabel} />
                    </td>
                    <td className="px-3 tabular-nums whitespace-nowrap">{r.receivedLabel}</td>
                    <td className="pl-3 whitespace-nowrap">
                      <DueDate label={r.dueLabel} overdue={r.overdue} daysLeft={r.daysLeft} />
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

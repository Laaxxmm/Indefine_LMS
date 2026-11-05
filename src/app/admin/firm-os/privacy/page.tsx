import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { btnPrimary, card, field, figure, focusRing, labelText, linkText, sectionTitle, td, tr } from "@/components/ui";
import { DataTable, EmptyState, Section } from "@/components/firm-os";
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

const control = `${field} w-auto font-normal text-ink`;

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
            <p className={`${figure} ${s.alert ? "text-rose-700" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <section className={`${card} mb-6`} aria-labelledby="new-request">
        <h2 id="new-request" className={sectionTitle}>
          Log a request
        </h2>
        <NewRequestForm kinds={kinds} today={istDayKey(now)} />
      </section>

      <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`} aria-label="Filter requests">
        <label className={`flex flex-col gap-1 ${labelText}`}>
          Status
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
        <label className={`flex flex-col gap-1 ${labelText}`}>
          Kind
          <select name="kind" defaultValue={filters.kind} className={control}>
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] leading-5 inline-flex items-center gap-2 h-9">
          <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} className={`h-4 w-4 rounded border-border ${focusRing}`} />
          Overdue only
        </label>
        <button type="submit" className={`${btnPrimary} h-9`}>
          Apply
        </button>
      </form>

      <Section id="requests" title="Requests, earliest due first" last className="min-w-0">
        {rows.length === 0 ? (
          <EmptyState title="No privacy requests match these filters." />
        ) : (
          <DataTable caption="Privacy requests, earliest due first" columns={[{ label: "Request" }, { label: "Person" }, { label: "Status" }, { label: "Received" }, { label: "Due" }]}>
            {rows.map((r) => (
              <tr key={r.id} className={tr}>
                <td className={td}>
                  <Link href={`/admin/firm-os/privacy/${encodeURIComponent(r.id)}`} className={linkText}>
                    {r.kindLabel}
                  </Link>
                </td>
                <td className={`${td} break-words`}>{r.principalLabel}</td>
                <td className={td}>
                  <RequestStatusChip status={r.status} label={r.statusLabel} />
                </td>
                <td className={`${td} tabular-nums whitespace-nowrap`}>{r.receivedLabel}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <DueDate label={r.dueLabel} overdue={r.overdue} daysLeft={r.daysLeft} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </main>
  );
}

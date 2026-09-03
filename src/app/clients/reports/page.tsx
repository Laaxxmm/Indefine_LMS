import Link from "next/link";
import { Download } from "lucide-react";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS, fyOptions, keysOf } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { GROUP_KEYS, filtersToQuery, groupRows, keyOf, loadJobRows, parseFilters, summarize, type GroupKey } from "@/lib/clients/reports";
import { RebuildButton } from "./RebuildButton";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const ist = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const group: GroupKey = sp.group && sp.group in GROUP_KEYS ? (sp.group as GroupKey) : "fy";
  const [rows, services, handlers] = await Promise.all([loadJobRows(parseFilters(sp)), listServiceTypes(true), listHandlers()]);
  const totals = summarize(rows);
  const groups = groupRows(rows, group);
  const drill = sp.drill ? rows.filter((r) => keyOf(r, group) === sp.drill) : null;

  const Sel = ({ name, label, children }: { name: string; label: string; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">{label}</span><select name={name} defaultValue={sp[name] ?? ""} className={field}><option value="">Any</option>{children}</select></label>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Reports</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">Client base</h1>
          <p className="text-ink-mute text-[15px] mt-1.5">Filter jobs, then group by year, month, department, service, handler, turnover band or growth goal.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`/api/clients/reports/export?${filtersToQuery(sp)}`} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop"><Download className="w-4 h-4" /> Download Excel</a>
          <RebuildButton />
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-6 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <Sel name="fy" label="FY">{fyOptions().map((f) => <option key={f}>{f}</option>)}</Sel>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Created from</span><input type="date" name="from" defaultValue={sp.from ?? ""} className={field} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">to</span><input type="date" name="to" defaultValue={sp.to ?? ""} className={field} /></label>
        <Sel name="department" label="Department">{DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</Sel>
        <Sel name="service" label="Service">{services.map((s) => <option key={s.id} value={s.id}>{departmentLabel(s.department)} · {s.name}</option>)}</Sel>
        <Sel name="handler" label="Handler">{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Sel>
        <Sel name="band" label="Turnover band">{keysOf(TURNOVER_BANDS).map((b) => <option key={b} value={b}>{TURNOVER_BANDS[b]}</option>)}</Sel>
        <Sel name="goal" label="Growth goal">{keysOf(GROWTH_GOALS).map((g) => <option key={g} value={g}>{GROWTH_GOALS[g]}</option>)}</Sel>
        <Sel name="status" label="Status">{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</Sel>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Group by</span><select name="group" defaultValue={group} className={field}>{(Object.keys(GROUP_KEYS) as GroupKey[]).map((k) => <option key={k} value={k}>{GROUP_KEYS[k]}</option>)}</select></label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Apply</button>
        <Link href="/clients/reports" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[["Clients", totals.clients], ["Jobs", totals.jobs], ["Open jobs", totals.open], ["Overdue", totals.overdue], ["Turnover in scope", inr(totals.turnover)]].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl bg-card border border-border shadow-lift p-4"><div className="text-[11px] font-bold text-ink-faint uppercase tracking-wide">{k}</div><div className="font-display font-extrabold text-2xl mt-1">{v}</div></div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift mb-6">
        <table className="w-full text-[13.5px]">
          <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left"><tr><th className="px-4 py-3">{GROUP_KEYS[group]}</th><th className="px-4 py-3">Jobs</th><th className="px-4 py-3">Clients</th><th className="px-4 py-3">Open</th><th className="px-4 py-3">Done</th><th className="px-4 py-3">Turnover</th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-faint">No jobs match these filters.</td></tr>}
            {groups.map((g) => (
              <tr key={g.key} className={`border-t border-border hover:bg-muted/40 ${sp.drill === g.key ? "bg-brand-50" : ""}`}>
                <td className="px-4 py-3 font-semibold"><Link href={`/clients/reports?${filtersToQuery(sp, { drill: g.key })}`} className="hover:text-brand-600">{g.key}</Link></td>
                <td className="px-4 py-3">{g.jobs}</td><td className="px-4 py-3">{g.clients}</td><td className="px-4 py-3">{g.open}</td><td className="px-4 py-3">{g.done}</td><td className="px-4 py-3">{inr(g.turnover)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drill && drill.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <div className="px-4 py-3 text-[12px] font-bold text-ink-mute">{GROUP_KEYS[group]}: {sp.drill} · {drill.length} job(s)</div>
          <table className="w-full text-[13.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left"><tr><th className="px-4 py-2">Client</th><th className="px-4 py-2">FY</th><th className="px-4 py-2">Service</th><th className="px-4 py-2">Handler</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Due</th></tr></thead>
            <tbody>
              {drill.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-semibold"><Link href={`/clients/${r.clientId}`} className="hover:text-brand-600">{r.client}</Link></td>
                  <td className="px-4 py-2">{r.fy}</td><td className="px-4 py-2">{departmentLabel(r.department)} · {r.service}</td><td className="px-4 py-2">{r.handler}</td>
                  <td className="px-4 py-2">{JOB_STATUSES[r.status]}</td><td className="px-4 py-2">{ist(r.dueOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

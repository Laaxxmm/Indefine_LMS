import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { ENTITY_TYPES, JOB_STATUSES, TURNOVER_BANDS, fyOptions, keysOf } from "@/lib/clients/core";
import { listHandlers } from "@/lib/clients/services";
import { isDone } from "@/lib/clients/reports";
import { Plus, Users } from "lucide-react";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function ClientsList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const handlers = await listHandlers();

  const jobWhere: Prisma.JobWhereInput = {};
  if (sp.fy) jobWhere.fy = sp.fy;
  if (sp.handler) jobWhere.handlerId = sp.handler;
  if (sp.status && sp.status in JOB_STATUSES) jobWhere.status = sp.status as keyof typeof JOB_STATUSES;
  if (sp.department && (DEPARTMENTS as string[]).includes(sp.department)) jobWhere.serviceType = { department: sp.department as (typeof DEPARTMENTS)[number] };

  const where: Prisma.ClientWhereInput = {};
  if (sp.q) where.OR = [{ name: { contains: sp.q, mode: "insensitive" } }, { pan: { contains: sp.q.toUpperCase() } }];
  if (sp.band && sp.band in TURNOVER_BANDS) where.turnoverBand = sp.band as keyof typeof TURNOVER_BANDS;
  if (Object.keys(jobWhere).length) where.jobs = { some: jobWhere };

  const clients = await prisma.client.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { primaryHandler: { select: { name: true, email: true } }, jobs: { select: { status: true, updatedAt: true } } },
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Client database</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">Every client the firm handles, with their jobs and documents on SharePoint.</p>
        </div>
        <Link href="/clients/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition">
          <Plus className="w-4 h-4" /> Onboard client
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-6 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-[11px] font-bold text-ink-mute">Name or PAN</span>
          <input name="q" defaultValue={sp.q ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">FY</span>
          <select name="fy" defaultValue={sp.fy ?? ""} className={field}><option value="">Any</option>{fyOptions().map((f) => <option key={f}>{f}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Department</span>
          <select name="department" defaultValue={sp.department ?? ""} className={field}><option value="">Any</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Handler</span>
          <select name="handler" defaultValue={sp.handler ?? ""} className={field}><option value="">Any</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Job status</span>
          <select name="status" defaultValue={sp.status ?? ""} className={field}><option value="">Any</option>{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Turnover</span>
          <select name="band" defaultValue={sp.band ?? ""} className={field}><option value="">Any</option>{keysOf(TURNOVER_BANDS).map((b) => <option key={b} value={b}>{TURNOVER_BANDS[b]}</option>)}</select>
        </label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Filter</button>
        <Link href="/clients" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      {clients.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <Users className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No clients match</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <table className="w-full text-[13.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Handler</th><th className="px-4 py-3">Turnover</th><th className="px-4 py-3">Open jobs</th><th className="px-4 py-3">Last activity</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const open = c.jobs.filter((j) => !isDone(j.status)).length;
                const last = [c.updatedAt, ...c.jobs.map((j) => j.updatedAt)].reduce((a, b) => (b > a ? b : a));
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-4 py-3 font-semibold"><Link href={`/clients/${c.id}`} className="hover:text-brand-600">{c.name}</Link>{!c.active && <span className="ml-2 text-[10.5px] uppercase text-ink-faint">inactive</span>}</td>
                    <td className="px-4 py-3">{ENTITY_TYPES[c.entityType]}</td>
                    <td className="px-4 py-3">{c.city ?? "—"}</td>
                    <td className="px-4 py-3">{c.primaryHandler.name ?? c.primaryHandler.email}</td>
                    <td className="px-4 py-3">{TURNOVER_BANDS[c.turnoverBand]}</td>
                    <td className="px-4 py-3">{open} / {c.jobs.length}</td>
                    <td className="px-4 py-3 text-ink-mute">{fmt(last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

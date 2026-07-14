import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { canEditSop, isSopAdmin, canViewSop } from "@/lib/sop/access";
import { departmentLabel } from "@/lib/sop/labels";
import { Plus, ShieldCheck, BookText, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

const DEPARTMENTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];

export default async function SopDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewSop(session.user)) redirect("/dashboard");
  const sp = await searchParams;
  const [canEdit, admin] = [await canEditSop(session.user), isSopAdmin(session.user)];

  const where: Prisma.SopWhereInput = {};
  if (sp.department && DEPARTMENTS.includes(sp.department)) where.department = sp.department as Prisma.SopWhereInput["department"];
  if (sp.q) where.title = { contains: sp.q, mode: "insensitive" };

  const sops = await prisma.sop.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { versionNumber: true, creatorName: true, createdAt: true } } },
  });

  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Tools · SOP Builder</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Standard Operating Procedures</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">Browse the firm's SOPs by department. {canEdit ? "Create new ones from a plain description — the AI refines it into a brief you confirm before generating." : "You have view access; ask an admin for edit rights to create or update SOPs."}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {admin && (
            <Link href="/tools/sop-builder/admin" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card text-sm font-semibold text-ink-soft hover:bg-muted transition">
              <ShieldCheck className="w-4 h-4" /> Editors
            </Link>
          )}
          {canEdit && (
            <Link href="/tools/sop-builder/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition">
              <Plus className="w-4 h-4" /> New SOP
            </Link>
          )}
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-6 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">Department</span>
          <select name="department" defaultValue={sp.department ?? ""} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-[11px] font-bold text-ink-mute">Search title</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. bank reconciliation" className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]" />
        </label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Filter</button>
        <Link href="/tools/sop-builder" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      {sops.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <BookText className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No SOPs yet</p>
          <p className="text-ink-mute text-sm mt-0.5">{canEdit ? "Create the first one with the New SOP button." : "SOPs will appear here once created."}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sops.map((s) => (
            <Link key={s.id} href={`/tools/sop-builder/${s.id}`} className="group bg-card border border-border rounded-[18px] p-5 shadow-lift hover:-translate-y-0.5 transition block">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10.5px] font-extrabold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{departmentLabel(s.department)}</span>
                <ArrowRight className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition" />
              </div>
              <div className="font-semibold text-[15px] leading-snug text-ink line-clamp-2">{s.title}</div>
              <div className="text-[12px] text-ink-mute mt-1.5">{s.workCategory}</div>
              <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-ink-faint">
                <span>v{s.versions[0]?.versionNumber ?? 1}</span>
                <span>·</span>
                <span>{s.versions[0]?.creatorName ?? s.createdByName}</span>
                <span>·</span>
                <span>{fmt(s.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

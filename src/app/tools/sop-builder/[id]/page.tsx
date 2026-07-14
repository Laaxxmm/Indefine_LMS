import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canViewSop, canEditSop, isSopAdmin } from "@/lib/sop/access";
import { departmentLabel } from "@/lib/sop/labels";
import { SopDocView } from "../SopDocView";
import type { SopContent } from "@/lib/sop/types";
import { ArrowLeft, Download, Pencil, History, Eye, User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewSop(session.user)) redirect("/dashboard");

  const { id } = await params;
  const { v } = await searchParams;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  if (!sop) notFound();

  const selected = sop.versions.find((x) => x.id === v) ?? sop.versions.find((x) => x.id === sop.currentVersionId) ?? sop.versions[0];
  const content = selected.content as unknown as SopContent;
  const [canEdit, admin] = [await canEditSop(session.user, sop.department), isSopAdmin(session.user)];

  // Audit — log this view (best-effort).
  await prisma.sopView.create({ data: { sopId: id, userId: session.user.id, userName: session.user.name ?? "Unknown" } }).catch(() => {});
  const recentViews = admin ? await prisma.sopView.findMany({ where: { sopId: id }, orderBy: { viewedAt: "desc" }, take: 25 }) : [];

  const fmt = (d: Date) => d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <Link href="/tools/sop-builder" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All SOPs
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <span className="text-[10.5px] font-extrabold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{departmentLabel(sop.department)}</span>
          <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mt-1.5 leading-tight">{sop.title}</h1>
          <p className="text-xs text-ink-faint font-bold mt-1">v{selected.versionNumber} · by {selected.creatorName}{selected.creatorDesignation ? ` (${selected.creatorDesignation})` : ""} · {fmt(selected.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`/api/tools/sop-builder/sops/${id}/download?v=${selected.id}`} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card text-sm font-semibold text-ink-soft hover:bg-muted transition">
            <Download className="w-4 h-4" /> Word
          </a>
          {canEdit && (
            <Link href={`/tools/sop-builder/${id}/edit`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition">
              <Pencil className="w-4 h-4" /> New version
            </Link>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
        <div className="rounded-[20px] bg-card border border-border shadow-lift p-6 sm:p-8">
          <SopDocView c={content} />
        </div>

        <div className="flex flex-col gap-4">
          {sop.versions.length > 1 && (
            <div className="rounded-2xl bg-card border border-border shadow-lift p-4">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5"><History className="w-3.5 h-3.5" /> Versions</div>
              <div className="flex flex-col gap-1">
                {sop.versions.map((ver) => (
                  <Link key={ver.id} href={`/tools/sop-builder/${id}?v=${ver.id}`} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition ${ver.id === selected.id ? "bg-brand-50 text-brand-700 font-bold" : "text-ink-soft hover:bg-muted"}`}>
                    <span>v{ver.versionNumber}</span>
                    <span className="text-[11px] text-ink-faint">{ver.createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {admin && (
            <div className="rounded-2xl bg-card border border-border shadow-lift p-4">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5"><Eye className="w-3.5 h-3.5" /> Recent views</div>
              {recentViews.length === 0 ? (
                <p className="text-[12px] text-ink-faint">No views yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {recentViews.map((view) => (
                    <li key={view.id} className="flex items-center gap-2 text-[12px] text-ink-soft">
                      <User className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                      <span className="truncate flex-1">{view.userName}</span>
                      <span className="text-[10.5px] text-ink-faint whitespace-nowrap">{fmt(view.viewedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

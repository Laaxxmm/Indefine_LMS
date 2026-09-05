import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { registry } from "@/lib/certificates/registry";
import { ArrowLeft, Download, FileText } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseCertificateTool(session.user)) redirect("/dashboard");
  const admin = isAdmin(session.user);
  const sp = await searchParams;

  const where: Prisma.CertificateIssueWhereInput = {};
  // Staff see only their own; admins see all (§5).
  if (!admin) where.createdById = session.user.id;
  else if (sp.creatorId) where.createdById = sp.creatorId;
  if (sp.formatId) where.formatId = sp.formatId;
  if (sp.from || sp.to) {
    where.createdAt = {};
    if (sp.from) where.createdAt.gte = new Date(sp.from);
    if (sp.to) where.createdAt.lte = new Date(`${sp.to}T23:59:59`);
  }

  const [issues, creators] = await Promise.all([
    prisma.certificateIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    admin
      ? prisma.certificateIssue.findMany({
          distinct: ["createdById"],
          select: { createdById: true, createdBy: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ]);

  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div>
      <Link href="/tools/certificate-generator" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Certification generator
      </Link>
      <div className="mb-5">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Certification generator</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">History</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">
          {admin ? "Every certificate issued across the firm." : "Certificates you have issued."} Re-download any of them — they regenerate deterministically.
        </p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-3 mb-5 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">Format</span>
          <select name="formatId" defaultValue={sp.formatId ?? ""} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">
            <option value="">All formats</option>
            {registry.map((t) => (
              <option key={t.id} value={t.id}>{t.romanNo.toUpperCase()} — {t.title.slice(0, 42)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">From</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]" />
        </label>
        {admin && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-mute">Creator</span>
            <select name="creatorId" defaultValue={sp.creatorId ?? ""} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">
              <option value="">Everyone</option>
              {creators.map((c) => (
                <option key={c.createdById} value={c.createdById}>{c.createdBy?.name ?? c.createdBy?.email ?? c.createdById}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Apply</button>
        <Link href="/tools/certificate-generator/history" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      {issues.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <FileText className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No certificates yet</p>
          <p className="text-ink-mute text-sm mt-0.5">Issued certificates will appear here.</p>
        </div>
      ) : (
        <div className="rounded-[20px] bg-card border border-border overflow-hidden shadow-lift">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-extrabold tracking-wide text-ink-mute uppercase">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Format</th>
                  <th className="px-4 py-2.5">Client</th>
                  {admin && <th className="px-4 py-2.5">Creator</th>}
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {issues.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/40 transition">
                    <td className="px-4 py-3 text-ink-mute whitespace-nowrap">{fmt(i.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{i.formatTitle}</span>
                      <span className="block text-[11px] text-ink-faint">v{i.templateVersion}</span>
                    </td>
                    <td className="px-4 py-3 font-medium">{i.clientName}</td>
                    {admin && <td className="px-4 py-3 text-ink-mute">{i.createdBy?.name ?? i.createdBy?.email ?? "—"}</td>}
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/api/tools/certificate-generator/${i.id}/download`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12.5px] font-bold text-brand-600 hover:bg-brand-50 transition"
                      >
                        <Download className="w-3.5 h-3.5" /> Download again
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

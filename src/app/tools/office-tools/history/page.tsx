import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { ArrowLeft, FileClock } from "lucide-react";

export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = {
  Legal: "bg-brand-50 text-brand-700",
  Tax: "bg-rose-50 text-rose-600",
  Financial: "bg-emerald-50 text-emerald-700",
};

export default async function OfficeToolsHistory() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseOfficeTools(session.user)) redirect("/dashboard");

  const runs = await prisma.officeToolRun.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const fmt = (d: Date) => d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <Link href="/tools/office-tools" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All office tools
      </Link>
      <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mb-1">Usage history</h1>
      <p className="text-ink-mute text-[14px] mb-6">Every document generated and tax file processed, across the team. Files are never stored — this is the audit trail.</p>

      {runs.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <FileClock className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No activity yet</p>
          <p className="text-ink-mute text-sm mt-0.5">Generated documents and processed files will appear here.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-card border border-border shadow-lift overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-ink-faint border-b border-border">
                  <th className="font-bold px-4 py-3">Tool</th>
                  <th className="font-bold px-4 py-3">Details</th>
                  <th className="font-bold px-4 py-3 whitespace-nowrap">By</th>
                  <th className="font-bold px-4 py-3 whitespace-nowrap">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9.5px] font-extrabold tracking-wide uppercase px-1.5 py-0.5 rounded-full ${BADGE[r.category] ?? "bg-muted text-ink-faint"}`}>{r.category}</span>
                        <span className="font-semibold text-ink">{r.toolTitle}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{r.summary}</td>
                    <td className="px-4 py-3 text-ink-soft whitespace-nowrap">{r.createdByName}</td>
                    <td className="px-4 py-3 text-ink-faint whitespace-nowrap">{fmt(r.createdAt)}</td>
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

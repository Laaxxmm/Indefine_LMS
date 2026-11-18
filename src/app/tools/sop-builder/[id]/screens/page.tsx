import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import type { SopContent } from "@/lib/sop/types";
import { ScreensEditor } from "../../ScreensEditor";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SopScreensPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!sop) notFound();
  if (!(await canEditSop(session.user, sop.department))) redirect(`/tools/sop-builder/${id}`);
  const latest = sop.versions[0];
  const content = latest.content as unknown as SopContent;
  const parts = (content.subProcesses ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    steps: p.steps.map((s) => ({ no: s.no, action: s.action, system: s.system, screens: s.screens ?? [] })),
  }));

  return (
    <div className="max-w-4xl">
      <Link href={`/tools/sop-builder/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to the SOP
      </Link>
      <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] leading-tight">Screens: {sop.title}</h1>
      <p className="text-ink-mute text-[14px] mt-1 mb-5">Add a screenshot under any step. Saving makes version {latest.versionNumber + 1} with the same steps and a new Word file in OneDrive.</p>
      {parts.length ? (
        <ScreensEditor sopId={id} baseVersionId={latest.id} nextVersion={latest.versionNumber + 1} parts={parts} />
      ) : (
        <p className="rounded-2xl bg-card border border-border shadow-lift p-5 text-[14px]">
          This SOP is in the older format, which has no step rows for screens. <Link href={`/tools/sop-builder/${id}/edit`} className="font-bold text-brand-700 hover:underline">Make a new version</Link> first, then add screens.
        </p>
      )}
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canEditSop, isSopAdmin } from "@/lib/sop/access";
import { SopCreator } from "../../SopCreator";

export const dynamic = "force-dynamic";

export default async function EditSopPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!sop) notFound();

  // Admins edit any SOP; granted editors only SOPs of their own department.
  if (!(await canEditSop(session.user, sop.department))) redirect("/tools/sop-builder");
  const latest = sop.versions[0];

  return (
    <SopCreator
      defaultDepartment={sop.department}
      lockDepartment={!isSopAdmin(session.user)}
      editSopId={id}
      initial={{ title: sop.title, workCategory: sop.workCategory, purpose: latest?.purpose ?? "", rawProcedure: latest?.rawProcedure ?? "", department: sop.department }}
    />
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canCreateSop, isSopAdmin } from "@/lib/sop/access";
import { SopCreator } from "../SopCreator";

export const dynamic = "force-dynamic";

export default async function NewSopPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!(await canCreateSop(session.user))) redirect("/tools/sop-builder");

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { department: true } });
  const dept = me?.department ?? "GENERAL";
  // Admins may author for any department; granted editors are locked to their own.
  return <SopCreator defaultDepartment={dept} lockDepartment={!isSopAdmin(session.user)} />;
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { SopCreator } from "../SopCreator";

export const dynamic = "force-dynamic";

export default async function NewSopPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!(await canEditSop(session.user))) redirect("/tools/sop-builder");

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { department: true } });
  return <SopCreator defaultDepartment={me?.department ?? "GENERAL"} />;
}

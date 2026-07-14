import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isSopAdmin } from "@/lib/sop/access";
import { GrantsManager } from "./GrantsManager";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SopAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isSopAdmin(session.user)) redirect("/tools/sop-builder");

  const editors = await prisma.sopEditor.findMany({ orderBy: { userName: "asc" }, select: { userId: true, userName: true, userEmail: true } });
  const editorIds = new Set(editors.map((e) => e.userId));
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true } });
  const candidates = users
    .filter((u) => u.role !== "ADMIN" && !editorIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email }));

  return (
    <div>
      <Link href="/tools/sop-builder" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> SOP Builder
      </Link>
      <div className="mb-5">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">SOP Builder · Admin</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">SOP editors</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">Everyone can view SOPs. Editors (plus all admins) can create and edit them.</p>
      </div>
      <GrantsManager initialEditors={editors} candidates={candidates} />
    </div>
  );
}

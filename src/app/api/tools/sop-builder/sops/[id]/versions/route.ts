import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { buildVersion, normDept, createBodyZ, resolveCreator } from "@/lib/sop/service";

export const maxDuration = 60;

// Add a new version to an existing SOP (an "edit"). Admins + granted editors only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!sop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Admins edit any SOP; granted editors only SOPs of their own department.
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit SOPs of this department" }, { status: 403 });

  const parsed = createBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { brief, rawProcedure, purpose } = parsed.data;

  const nextNumber = (sop.versions[0]?.versionNumber ?? 0) + 1;
  const creator = await resolveCreator(session.user);

  let versionData;
  try {
    versionData = await buildVersion({ brief, rawProcedure, purpose, versionNumber: nextNumber, revision: `${nextNumber}.0`, creator });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const version = await prisma.sopVersion.create({ data: { sopId: id, ...versionData } });
  await prisma.sop.update({
    where: { id },
    data: { currentVersionId: version.id, title: brief.title, department: normDept(brief.department), workCategory: brief.workCategory },
  });

  return NextResponse.json({ id, versionId: version.id }, { status: 201 });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { buildVersion, normDept, createBodyZ, resolveCreator } from "@/lib/sop/service";

export const maxDuration = 60;

// Create a new SOP (version 1). Admins + granted editors only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { brief, rawProcedure, purpose } = parsed.data;

  // Non-admin editors may only create SOPs for their own department.
  if (!(await canEditSop(session.user, normDept(brief.department))))
    return NextResponse.json({ error: "You can only create SOPs for your own department" }, { status: 403 });
  const creator = await resolveCreator(session.user);

  let versionData;
  try {
    versionData = await buildVersion({ brief, rawProcedure, purpose, versionNumber: 1, revision: "1.0", creator });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const sop = await prisma.sop.create({
    data: {
      title: brief.title,
      department: normDept(brief.department),
      workCategory: brief.workCategory,
      createdById: creator.id,
      createdByName: creator.name,
      versions: { create: versionData },
    },
    include: { versions: { select: { id: true } } },
  });
  await prisma.sop.update({ where: { id: sop.id }, data: { currentVersionId: sop.versions[0]?.id } });

  return NextResponse.json({ id: sop.id }, { status: 201 });
}

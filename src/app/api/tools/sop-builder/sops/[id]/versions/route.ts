import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { buildVersion, normDept, createBodyZ, resolveCreator } from "@/lib/sop/service";
import { validationMessage, failureSentence } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const maxDuration = 60;

// Add a new version to an existing SOP (an "edit"). Admins + granted editors only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!sop) return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });

  // Admins edit any SOP; granted editors only SOPs of their own department.
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit this department's SOPs. Ask an admin." }, { status: 403 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = createBodyZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const { brief, rawProcedure, purpose } = parsed.data;
  // The edit may move the SOP to another department; the editor must be allowed there too.
  if (!(await canEditSop(session.user, normDept(brief.department))))
    return NextResponse.json({ error: "You can only move SOPs into your own department." }, { status: 403 });

  const nextNumber = (sop.versions[0]?.versionNumber ?? 0) + 1;
  const creator = await resolveCreator(session.user);

  let versionData;
  try {
    versionData = await buildVersion({ brief, rawProcedure, purpose, versionNumber: nextNumber, revision: `${nextNumber}.0`, creator });
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The new SOP version could not be saved.", "Try again in a minute.") }, { status: 502 });
  }

  const version = await prisma.sopVersion.create({ data: { sopId: id, ...versionData } });
  await prisma.sop.update({
    where: { id },
    data: { currentVersionId: version.id, title: brief.title, department: normDept(brief.department), workCategory: brief.workCategory },
  });

  return NextResponse.json({ id, versionId: version.id }, { status: 201 });
}

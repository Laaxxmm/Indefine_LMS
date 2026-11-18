import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { canEditSop } from "@/lib/sop/access";
import { aiFailure, buildVersion, fileAfterSave, normDept, createBodyZ, resolveCreator } from "@/lib/sop/service";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";

export const maxDuration = 60;

// Create a new SOP (version 1). Admins + granted editors only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = createBodyZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const { brief, rawProcedure, purpose } = parsed.data;

  // Non-admin editors may only create SOPs for their own department.
  if (!(await canEditSop(session.user, normDept(brief.department))))
    return NextResponse.json({ error: "You can only create SOPs for your own department." }, { status: 403 });
  // Up to 9 Gemini calls per Generate: counted per person, refused when the counter cannot be read.
  const limited = await enforceRateLimit("sop-generate", session.user.id);
  if (limited) return limited;
  const creator = await resolveCreator(session.user);

  let versionData;
  try {
    versionData = await buildVersion({ brief, rawProcedure, purpose, versionNumber: 1, revision: "1.0", creator });
  } catch (e) {
    const f = aiFailure(e, "The SOP could not be saved.", "Try again in a minute.");
    return NextResponse.json(f.body, { status: f.status });
  }

  const sop = await prisma.$transaction(async (tx) => {
    const made = await tx.sop.create({
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
    await tx.sop.update({ where: { id: made.id }, data: { currentVersionId: made.versions[0]?.id } });
    await logAudit(tx, { actorId: creator.id, action: "sop.create", entity: "Sop", entityId: made.id, meta: { versionId: made.versions[0]?.id ?? null, department: normDept(brief.department) } });
    return made;
  });
  // The SOP is saved: a OneDrive problem is a notice, never a failure.
  const filed = sop.versions[0] ? await fileAfterSave(sop.id, sop.versions[0].id, creator.id) : { webUrl: null };

  return NextResponse.json({ id: sop.id, ...(filed.notice ? { notice: filed.notice } : {}) }, { status: 201 });
}

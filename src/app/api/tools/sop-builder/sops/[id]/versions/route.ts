import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { addVersion, aiFailure, buildVersion, fileAfterSave, normDept, createBodyZ, removedScreenIds, resolveCreator } from "@/lib/sop/service";
import { withoutScreens } from "@/lib/sop/screens";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";
import type { SopContent } from "@/lib/sop/types";

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
  const limited = await enforceRateLimit("sop-generate", session.user.id);
  if (limited) return limited;

  const nextNumber = (sop.versions[0]?.versionNumber ?? 0) + 1;
  const creator = await resolveCreator(session.user);

  let versionData;
  try {
    // A removed screen does not come back on the new version.
    const last = sop.versions[0]?.content as unknown as SopContent | undefined;
    const previous = last ? withoutScreens(last, await removedScreenIds(id)) : undefined;
    versionData = await buildVersion({ brief, rawProcedure, purpose, versionNumber: nextNumber, revision: `${nextNumber}.0`, creator, previous });
  } catch (e) {
    const f = aiFailure(e, "The new SOP version could not be saved.", "Try again in a minute.");
    return NextResponse.json(f.body, { status: f.status });
  }

  // Writing the version takes up to a minute; a version saved meanwhile (screens, another edit)
  // would be lost under this one, so it is refused instead.
  const versionId = await addVersion(id, sop.versions[0]?.id ?? null, versionData, { title: brief.title, department: normDept(brief.department), workCategory: brief.workCategory });
  if (!versionId)
    return NextResponse.json({ error: "Someone saved a newer version of this SOP while this one was being written. Open the SOP again and make your change on the newest version." }, { status: 409 });
  const filed = await fileAfterSave(id, versionId, creator.id);

  return NextResponse.json({ id, versionId, ...(filed.notice ? { notice: filed.notice } : {}) }, { status: 201 });
}

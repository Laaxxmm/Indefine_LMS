import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { addVersion, fileToOneDrive, resolveCreator, versionString } from "@/lib/sop/service";
import { stripSecrets } from "@/lib/sop/gemini";
import { applyScreens, CAPTION_MAX, SCREENS_PER_STEP } from "@/lib/sop/screens";
import type { SopContent } from "@/lib/sop/types";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";
import { crossSiteRefusal } from "@/lib/hardening/uploads";

export const maxDuration = 60;

const bodyZ = z.object({
  baseVersionId: z.string().min(1).max(40),
  screens: z.record(z.string().max(20), z.array(z.object({ imageId: z.string().min(1).max(40), caption: z.string().max(CAPTION_MAX).default("") })).max(SCREENS_PER_STEP)),
});

const CONFLICT = "Someone saved a newer version of this SOP while you were adding screens. Reload the page and add them again.";

// Save the author's screenshots as a new version: the current version's text with screens under
// its steps, and a new Word file in the SOP's OneDrive folder. Nothing goes to the AI.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const refused = crossSiteRefusal(req);
  if (refused) return refused;

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!sop) return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit this department's SOPs. Ask an admin." }, { status: 403 });

  const jsonBody = await readJsonCapped(req);
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = bodyZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const { baseVersionId, screens } = parsed.data;

  const latest = sop.versions[0];
  if (!latest || latest.id !== baseVersionId)
    return NextResponse.json({ error: CONFLICT }, { status: 409 });
  const content = latest.content as unknown as SopContent;
  if (!content.subProcesses?.length)
    return NextResponse.json({ error: "This SOP is in the older format. Make a new version first, then add screens." }, { status: 400 });

  const ids = [...new Set(Object.values(screens).flatMap((list) => list.map((s) => s.imageId)))];
  if ((await prisma.sopImage.count({ where: { id: { in: ids }, sopId: id } })) !== ids.length)
    return NextResponse.json({ error: "A screen could not be found. Reload the page and add it again." }, { status: 400 });
  // A credential typed into a caption is never stored, as in every other SOP field.
  const captioned = Object.fromEntries(Object.entries(screens).map(([no, list]) => [no, list.map((s) => ({ imageId: s.imageId, caption: stripSecrets(s.caption.trim()) }))]));
  const applied = applyScreens(content, captioned);
  if ("error" in applied) return NextResponse.json({ error: applied.error }, { status: 400 });

  const versionNumber = latest.versionNumber + 1;
  const next: SopContent = { ...applied.content, revision: `${versionNumber}.0`, effectiveDate: new Date().toLocaleDateString("en-GB") };
  const creator = await resolveCreator(session.user);
  const versionId = await addVersion(id, latest.id, {
    versionNumber,
    versionString: versionString(sop.title, versionNumber),
    purpose: latest.purpose,
    rawProcedure: latest.rawProcedure,
    brief: latest.brief === null ? Prisma.JsonNull : (latest.brief as Prisma.InputJsonValue),
    content: next as unknown as Prisma.InputJsonValue,
    createdById: creator.id,
    creatorName: creator.name,
    creatorDesignation: creator.designation,
  });
  if (!versionId) return NextResponse.json({ error: CONFLICT }, { status: 409 });
  await fileToOneDrive(id, versionId, creator.id);
  return NextResponse.json({ id, versionId }, { status: 201 });
}

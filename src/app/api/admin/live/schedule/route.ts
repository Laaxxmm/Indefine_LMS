// Schedule a live session (admin), with optional material files. Re-audit NEW-6: this was a server
// action on /admin/live, which forced experimental.serverActions.bodySizeLimit to 51 MB for every
// page. As a route handler it reads the multipart body with readMultipartUpload — capped while it
// streams, at most MAX_MATERIALS files, each type-screened — and the server action limit is back to
// 2 MB. The form posts here directly; the answer is a redirect back to /admin/live, as before.
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isActive, isAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit/log";
import { failureSentence } from "@/lib/errors";
import { MATERIAL_MAX_BYTES, MATERIAL_TYPES, MULTIPART_FRAMING_BYTES, crossSiteRefusal, readMultipartUpload } from "@/lib/hardening/uploads";
import { scheduleRecurring } from "@/lib/live/schedule";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;

/** Most material files on one session. */
const MAX_MATERIALS = 10;

/** 303 back to /admin/live (a relative Location: right behind any proxy). */
const back = (query: string) => new NextResponse(null, { status: 303, headers: { Location: `/admin/live?${query}` } });
const backWithError = (msg: string) => back(`error=${encodeURIComponent(msg)}`);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isActive(session.user) || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Only admins can schedule live sessions. Sign in with an admin account, or ask an admin." }, { status: 403 });
  }
  const refused = crossSiteRefusal(req);
  if (refused) return refused;

  const read = await readMultipartUpload(req, {
    fields: ["materials"],
    maxFiles: MAX_MATERIALS,
    maxBytes: MATERIAL_MAX_BYTES,
    maxTotalBytes: MATERIAL_MAX_BYTES + MULTIPART_FRAMING_BYTES,
    types: MATERIAL_TYPES,
    source: "admin-live-materials",
  });
  if (!read.ok) {
    const body = (await read.res.json().catch(() => null)) as { error?: string } | null;
    return backWithError(body?.error ?? "The session could not be scheduled. Check the details and try again.");
  }
  if (read.rejected.length) return backWithError(`${read.rejected[0].reason} Nothing was scheduled; remove that file and try again.`);

  const form = read.form;
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const title = text("title");
  const courseTitle = text("courseTitle");
  const folderParent = text("folderParent") || null;
  const description = text("description") || null;
  const startLocal = text("startLocal");
  const durationMin = Number(form.get("durationMin") || 60);
  const attendeeUserIds = form.getAll("attendeeIds").map(String).filter(Boolean);
  const repeatRaw = text("repeat") || "none";
  const repeat = (["none", "daily", "weekly"].includes(repeatRaw) ? repeatRaw : "none") as "none" | "daily" | "weekly";
  const occurrences = Number(form.get("occurrences") || 1);
  if (!title || !courseTitle || !startLocal) return backWithError("Enter a title, a course and a start time, then schedule the session again.");

  // Organizer = the Teams meeting host. The meeting is created with THEIR delegated token, so they
  // must have signed in to the LMS at least once. Falls back to the scheduling admin.
  let organizerId = text("organizerId") || session.user.id;
  if (organizerId !== session.user.id) {
    const ok = await prisma.account.findFirst({ where: { userId: organizerId, provider: "microsoft-entra-id" }, select: { id: true } });
    if (!ok) organizerId = session.user.id;
  }

  const materials = read.files.map((f) => ({ name: f.name, bytes: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer }));
  try {
    await scheduleRecurring(
      {
        title,
        courseTitle,
        folderParent,
        description,
        startLocal,
        durationMin: Number.isFinite(durationMin) ? durationMin : 60,
        attendeeUserIds,
        materials,
      },
      organizerId,
      repeat,
      Number.isFinite(occurrences) ? occurrences : 1,
    );
  } catch (e) {
    return backWithError(failureSentence(e, "The session could not be scheduled.", "Check the details and try again."));
  }
  // No titles or file names in the audit row (they can name a client); counts only.
  await logAudit(prisma, { actorId: session.user.id, action: "schedule-live-session", entity: "LiveSession", entityId: null, meta: { repeat, occurrences, attendees: attendeeUserIds.length, materials: materials.length } });
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  return back("tab=sessions&scheduled=1");
}

// Attach a downloadable handout to a video (admin). Re-audit NEW-6: this was a server action on
// /admin/video/[id], which forced experimental.serverActions.bodySizeLimit to 51 MB for every page
// (a forged session cookie bought a 51 MB body there). As a route handler it reads the multipart
// body with readUploadForm — capped while it streams, one file, type-screened — and the server
// action limit is back to 2 MB. The file goes into the SAME SharePoint folder as the video; only the
// Graph pointer is stored. The form posts here directly; the answer is a redirect back to the page
// with a one-line result (?matinfo=), as before.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isActive, isAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit/log";
import { failureSentence } from "@/lib/errors";
import { getAppOnlyToken, getItemParentId, getUserGraphToken, resolveFolderId, uploadFileToFolderId } from "@/lib/graph";
import { MATERIAL_MAX_BYTES, MATERIAL_TYPES, crossSiteRefusal, extOf, readUploadForm } from "@/lib/hardening/uploads";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const maxDuration = 120;

/** 303 back to the admin video page with a one-line result (a relative Location: right behind any proxy). */
const back = (videoId: string, msg: string) => new NextResponse(null, { status: 303, headers: { Location: `/admin/video/${encodeURIComponent(videoId)}?matinfo=${encodeURIComponent(msg)}` } });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !isActive(session.user) || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Only admins can attach materials. Sign in with an admin account, or ask an admin." }, { status: 403 });
  }
  const refused = crossSiteRefusal(req);
  if (refused) return refused;
  const { id: videoId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(videoId)) return NextResponse.json({ error: "That video could not be found. Reload the page and try again." }, { status: 404 });

  const upload = await readUploadForm(req, { field: "file", maxBytes: MATERIAL_MAX_BYTES, types: MATERIAL_TYPES, source: "admin-handout" });
  if (!upload.ok) {
    const body = (await upload.res.json().catch(() => null)) as { error?: string } | null;
    return back(videoId, body?.error ?? "The material could not be uploaded. Choose the file again and try once more.");
  }
  const file = upload.file;

  try {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) return back(videoId, "That video could not be found. Reload the page and try again.");
    const token = (await getAppOnlyToken()) ?? (await getUserGraphToken(session.user.id));
    if (!token) return back(videoId, "Microsoft 365 is not connected, so the file could not be stored. Ask IT to connect it, then try again.");

    // Beside the video (that folder already lives under the L&D root); else the L&D root itself.
    let folderId = await getItemParentId(video.graphDriveId, video.graphItemId, token);
    const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
    if (!folderId && rootPath) folderId = await resolveFolderId(video.graphDriveId, rootPath, token);
    if (!folderId) return back(videoId, "No folder could be found to store the file in. Ask IT to check the video's SharePoint folder.");

    const bytes = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    const uploaded = await uploadFileToFolderId(video.graphDriveId, folderId, file.name, bytes, token);
    if (!uploaded) return back(videoId, "SharePoint refused the upload. Ask IT to check the app's permission to write files.");

    const count = await prisma.material.count({ where: { videoId } });
    const material = await prisma.material.create({
      data: { videoId, name: file.name, graphDriveId: video.graphDriveId, graphItemId: uploaded.id, sizeBytes: uploaded.size || file.bytes.length, order: count },
      select: { id: true },
    });
    // No file name in the audit row: names can carry a client's name (ADR-006).
    await logAudit(prisma, { actorId: session.user.id, action: "attach-material", entity: "Material", entityId: material.id, meta: { videoId, ext: extOf(file.name), sizeBytes: file.bytes.length } });
    revalidatePath(`/admin/video/${videoId}`);
    revalidatePath(`/video/${videoId}`);
    return back(videoId, "Material attached.");
  } catch (e) {
    return back(videoId, failureSentence(e, "The material could not be uploaded.", "Try again in a minute."));
  }
}

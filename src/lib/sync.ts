// Sync the configured OneDrive folder into our DB so each video has a stable id.
// We keep a single default Course/Module to start; admins can re-organize later.

import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getUserGraphToken, listFolderVideos } from "@/lib/graph";

const DEFAULT_COURSE_TITLE = "General Training";
const DEFAULT_MODULE_TITLE = "All Videos";

async function ensureDefaults() {
  let course = await prisma.course.findFirst({
    where: { title: DEFAULT_COURSE_TITLE },
    include: { modules: true },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        title: DEFAULT_COURSE_TITLE,
        description: "Auto-imported videos from OneDrive",
        published: true,
        modules: { create: [{ title: DEFAULT_MODULE_TITLE, order: 0 }] },
      },
      include: { modules: true },
    });
  }
  const mod = course.modules[0] ?? (await prisma.module.create({
    data: { courseId: course.id, title: DEFAULT_MODULE_TITLE, order: 0 },
  }));
  return { courseId: course.id, moduleId: mod.id };
}

export async function syncOneDriveVideos(opts: { fallbackUserId?: string } = {}) {
  const driveId = process.env.GRAPH_DRIVE_ID;
  const folderId = process.env.GRAPH_VIDEOS_FOLDER_ID;
  if (!driveId || !folderId) {
    throw new Error("GRAPH_DRIVE_ID and GRAPH_VIDEOS_FOLDER_ID must be set");
  }

  let token = await getAppOnlyToken();
  if (!token && opts.fallbackUserId) {
    token = await getUserGraphToken(opts.fallbackUserId);
  }
  if (!token) throw new Error("No Graph token available");

  const items = await listFolderVideos(driveId, folderId, token);
  const { moduleId } = await ensureDefaults();

  const results: { added: number; updated: number } = { added: 0, updated: 0 };
  for (const [i, item] of items.entries()) {
    const existing = await prisma.video.findFirst({
      where: { graphItemId: item.id, graphDriveId: driveId },
    });
    if (existing) {
      await prisma.video.update({
        where: { id: existing.id },
        data: {
          title: item.name,
          durationSeconds: item.video?.duration ? Math.round(item.video.duration / 1000) : existing.durationSeconds,
        },
      });
      results.updated++;
    } else {
      await prisma.video.create({
        data: {
          moduleId,
          title: item.name,
          graphDriveId: driveId,
          graphItemId: item.id,
          durationSeconds: item.video?.duration ? Math.round(item.video.duration / 1000) : null,
          order: i,
        },
      });
      results.added++;
    }
  }
  return results;
}

// Sync a SharePoint/OneDrive folder tree into our DB.
//
// Layout convention:
//   Configured root folder        → Course "General Training" (auto-created)
//   Each immediate subfolder      → Module
//   Videos inside subfolders      → Video rows under the matching Module
//   Videos directly in the root   → grouped under a fallback Module "Uncategorized"
//
// Re-running the sync is idempotent — videos are matched by (graphDriveId, graphItemId).

import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getUserGraphToken, listVideosRecursive } from "@/lib/graph";

const DEFAULT_COURSE_TITLE = "General Training";
const FALLBACK_MODULE_TITLE = "Uncategorized";

async function ensureCourse() {
  const existing = await prisma.course.findFirst({
    where: { title: DEFAULT_COURSE_TITLE },
  });
  if (existing) return existing;
  return prisma.course.create({
    data: {
      title: DEFAULT_COURSE_TITLE,
      description: "Auto-imported from SharePoint",
      published: true,
    },
  });
}

async function ensureModule(courseId: string, title: string, order: number) {
  const found = await prisma.module.findFirst({
    where: { courseId, title },
  });
  if (found) return found;
  return prisma.module.create({
    data: { courseId, title, order },
  });
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

  const items = await listVideosRecursive(driveId, folderId, token);
  const course = await ensureCourse();

  // Group videos by their immediate parent folder name. Items found in the
  // root sync folder fall under the fallback module.
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    // Walk up: if parentPath has length 1 it's the root, use fallback.
    const moduleName =
      item.parentPath.length > 1 ? item.parentFolderName : FALLBACK_MODULE_TITLE;
    const list = groups.get(moduleName) ?? [];
    list.push(item);
    groups.set(moduleName, list);
  }

  let added = 0;
  let updated = 0;
  let moduleOrder = 0;

  for (const [moduleName, moduleItems] of groups) {
    const mod = await ensureModule(course.id, moduleName, moduleOrder++);
    for (const [i, item] of moduleItems.entries()) {
      const existing = await prisma.video.findFirst({
        where: { graphItemId: item.id, graphDriveId: driveId },
      });
      const durationSec = item.video?.duration
        ? Math.round(item.video.duration / 1000)
        : null;

      if (existing) {
        await prisma.video.update({
          where: { id: existing.id },
          data: {
            title: item.name,
            moduleId: mod.id,
            durationSeconds: durationSec ?? existing.durationSeconds,
          },
        });
        updated++;
      } else {
        await prisma.video.create({
          data: {
            moduleId: mod.id,
            title: item.name,
            graphDriveId: driveId,
            graphItemId: item.id,
            durationSeconds: durationSec,
            order: i,
          },
        });
        added++;
      }
    }
  }

  return { added, updated, modules: groups.size };
}

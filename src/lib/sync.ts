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

async function ensureModule(
  courseId: string,
  title: string,
  order: number,
  groupName: string | null
) {
  const found = await prisma.module.findFirst({
    where: { courseId, title },
  });
  if (found) {
    // Keep the grouping in sync if the folder was moved under a parent.
    if ((found.groupName ?? null) !== groupName) {
      return prisma.module.update({ where: { id: found.id }, data: { groupName } });
    }
    return found;
  }
  return prisma.module.create({
    data: { courseId, title, order, groupName },
  });
}

export async function syncOneDriveVideos(opts: { fallbackUserId?: string } = {}) {
  const driveId = process.env.GRAPH_DRIVE_ID;
  const folderPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
  const folderId = process.env.GRAPH_VIDEOS_FOLDER_ID;
  if (!driveId || (!folderPath && !folderId)) {
    throw new Error(
      "GRAPH_DRIVE_ID and one of GRAPH_VIDEOS_FOLDER_PATH or GRAPH_VIDEOS_FOLDER_ID must be set"
    );
  }

  let token = await getAppOnlyToken();
  if (!token && opts.fallbackUserId) {
    token = await getUserGraphToken(opts.fallbackUserId);
  }
  if (!token) throw new Error("No Graph token available");

  // Prefer the path-based root reference because top-level item IDs in
  // SharePoint sometimes don't round-trip cleanly through /items/{id}/children.
  const root = folderPath
    ? ({ kind: "path", folderPath } as const)
    : ({ kind: "id", itemId: folderId! } as const);

  const rootName = folderPath
    ? folderPath.split("/").filter(Boolean).pop() ?? "Videos"
    : "Videos";

  const items = await listVideosRecursive(driveId, root, token, rootName);
  const course = await ensureCourse();

  // Group videos by their immediate parent folder name (= Module). Items found
  // in the root sync folder fall under the fallback module. The folder ONE level
  // above the module (when the module is nested, e.g. L&D/Accounting/Isha Misty
  // KT) becomes the module's groupName so the library mirrors the nesting.
  const groups = new Map<string, { items: typeof items; group: string | null }>();
  for (const item of items) {
    // parentPath = [rootName, ...intermediate..., leafFolder]. Length 1 → root.
    const moduleName =
      item.parentPath.length > 1 ? item.parentFolderName : FALLBACK_MODULE_TITLE;
    // The grouping folder is the one just above the module's leaf (only if the
    // module is nested deeper than one level under the root).
    const group =
      item.parentPath.length > 2 ? item.parentPath[item.parentPath.length - 2] : null;
    const g = groups.get(moduleName) ?? { items: [], group };
    g.items.push(item);
    if (!g.group && group) g.group = group;
    groups.set(moduleName, g);
  }

  let added = 0;
  let updated = 0;
  let moduleOrder = 0;

  for (const [moduleName, { items: moduleItems, group }] of groups) {
    const mod = await ensureModule(course.id, moduleName, moduleOrder++, group);
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

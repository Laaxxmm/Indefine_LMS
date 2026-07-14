import { getAppOnlyToken, getUserGraphToken, ensureFolder, uploadFileContent } from "@/lib/graph";
import { departmentLabel } from "./labels";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "SOP";

// Save a SOP version's .docx into OneDrive under <L&D root>/SOP/<Department>/. Best-effort:
// the DB is the source of truth, so a Graph/config problem never blocks SOP creation.
export async function saveSopDocxToOneDrive(opts: {
  department: string;
  title: string;
  versionNumber: number;
  docx: Buffer;
  userId: string;
}): Promise<{ itemId: string; webUrl: string } | null> {
  const driveId = process.env.GRAPH_DRIVE_ID;
  const ldRoot = process.env.GRAPH_VIDEOS_FOLDER_PATH; // the shared L&D folder path
  if (!driveId || !ldRoot) {
    console.warn("SOP OneDrive save skipped — GRAPH_DRIVE_ID / GRAPH_VIDEOS_FOLDER_PATH not set");
    return null;
  }
  const token = (await getAppOnlyToken()) ?? (await getUserGraphToken(opts.userId));
  if (!token) {
    console.warn("SOP OneDrive save skipped — no Graph token available");
    return null;
  }
  try {
    const dept = departmentLabel(opts.department);
    await ensureFolder(driveId, ldRoot, "SOP", token);
    await ensureFolder(driveId, `${ldRoot}/SOP`, dept, token);
    const filename = `${sanitize(opts.title)}_v${opts.versionNumber}.docx`;
    const fullPath = `${ldRoot}/SOP/${dept}/${filename}`;
    const item = await uploadFileContent(driveId, fullPath, new Uint8Array(opts.docx), DOCX_MIME, token);
    return { itemId: item.id, webUrl: item.webUrl };
  } catch (e) {
    console.error("SOP OneDrive save failed:", (e as Error).message);
    return null;
  }
}

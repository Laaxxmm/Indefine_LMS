import { getAppOnlyToken, getUserGraphToken, ensureFolder, getDriveItem, createFolderIn, moveDriveItem, uploadFileToFolderId } from "@/lib/graph";
import { departmentLabel } from "./labels";

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "SOP";

export type SopOneDriveSave = { folderId: string | null; itemId: string | null; webUrl: string | null };

// Save a SOP version's .docx into the SOP's own OneDrive folder:
//   <L&D root>/SOP/<Department>/<Title>/<Title>_v<N>.docx
// The folder is made the first time (OneDrive numbers it when another SOP already has the name)
// and found by id after that, so a rename never splits the SOP and a same-title SOP never
// overwrites it. A deleted folder is made again; a department change moves it. Best-effort: the
// DB is the source of truth, so a Graph/config problem never blocks the SOP. The version then has
// no itemId, and the SOP page offers to save it again.
export async function saveSopDocxToOneDrive(opts: {
  folderId: string | null;
  // Records a folder this save made and returns the folder to use (another save's, if it won).
  claimFolder?: (made: string) => Promise<string>;
  department: string;
  title: string;
  versionNumber: number;
  docx: Buffer;
  userId: string;
}): Promise<SopOneDriveSave> {
  let folderId = opts.folderId;
  const driveId = process.env.GRAPH_DRIVE_ID;
  const ldRoot = process.env.GRAPH_VIDEOS_FOLDER_PATH; // the shared L&D folder path
  if (!driveId || !ldRoot) {
    console.warn("SOP OneDrive save skipped — GRAPH_DRIVE_ID / GRAPH_VIDEOS_FOLDER_PATH not set");
    return { folderId, itemId: null, webUrl: null };
  }
  const token = (await getAppOnlyToken()) ?? (await getUserGraphToken(opts.userId));
  if (!token) {
    console.warn("SOP OneDrive save skipped — no Graph token available");
    return { folderId, itemId: null, webUrl: null };
  }
  try {
    const dept = departmentLabel(opts.department);
    await ensureFolder(driveId, ldRoot, "SOP", token);
    const deptId = await ensureFolder(driveId, `${ldRoot}/SOP`, dept, token);
    const folder = folderId ? await getDriveItem(driveId, folderId, token) : null;
    let id = folder?.id;
    if (!id) {
      const made = await createFolderIn(driveId, deptId, sanitize(opts.title), token);
      id = opts.claimFolder ? await opts.claimFolder(made) : made;
    }
    folderId = id;
    if (folder && folder.parentId !== deptId && !(await moveDriveItem(driveId, id, deptId, token)))
      console.warn(`SOP folder ${id} could not move to ${dept} (a folder there may have the same name); left where it was`);
    const filename = `${sanitize(opts.title)}_v${opts.versionNumber}.docx`;
    const item = await uploadFileToFolderId(driveId, id, filename, new Uint8Array(opts.docx).buffer, token, "replace");
    return { folderId, itemId: item?.id ?? null, webUrl: item?.webUrl ?? null };
  } catch (e) {
    console.error("SOP OneDrive save failed:", (e as Error).message);
    return { folderId, itemId: null, webUrl: null };
  }
}

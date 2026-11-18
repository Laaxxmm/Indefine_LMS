import { getAppOnlyToken, getUserGraphToken, ensureFolder, getDriveItem, createFolderIn, moveDriveItem, uploadFileToFolderId, replaceDriveItemContent } from "@/lib/graph";
import { departmentLabel } from "./labels";

// OneDrive refuses a name that ends in "." or a space, so the end is cleaned after the cut to 80.
export const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[\s.]+$/, "") || "SOP";

export type SopOneDriveSave = { folderId: string | null; itemId: string | null; webUrl: string | null };

/** Drive and token for a SOP save, or null when OneDrive is not set up (the reason is logged). */
async function driveAccess(userId: string): Promise<{ driveId: string; ldRoot: string; token: string } | null> {
  const driveId = process.env.GRAPH_DRIVE_ID;
  const ldRoot = process.env.GRAPH_VIDEOS_FOLDER_PATH; // the shared L&D folder path
  if (!driveId || !ldRoot) {
    console.warn("SOP OneDrive save skipped — GRAPH_DRIVE_ID / GRAPH_VIDEOS_FOLDER_PATH not set");
    return null;
  }
  const token = (await getAppOnlyToken()) ?? (await getUserGraphToken(userId));
  if (!token) {
    console.warn("SOP OneDrive save skipped — no Graph token available");
    return null;
  }
  return { driveId, ldRoot, token };
}

// Save a SOP version's .docx into the SOP's own OneDrive folder:
//   <L&D root>/SOP/<Department>/<Title>/<Title>_v<N>.docx
// The folder is made the first time (OneDrive numbers it when another SOP already has the name)
// and found by id after that, so a rename never splits the SOP and a same-title SOP never
// overwrites it. A deleted folder is made again; a department change moves it. Best-effort: the
// DB is the source of truth, so a Graph/config problem never blocks the SOP. The version then has
// no itemId, and the SOP page offers to save it again.
//
// Who can open the files (SOP review M1): the SOP folders are made inside the shared L&D folder and
// inherit its OneDrive permissions — everyone that folder is shared with can open every SOP's Word
// file and the screenshots in it. Nothing here shares or unshares; change who can see them on the
// L&D folder itself (docs/dpdp/data-inventory.md, "SOP Builder").
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
  const access = await driveAccess(opts.userId);
  if (!access) return { folderId, itemId: null, webUrl: null };
  const { driveId, ldRoot, token } = access;
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

export type SopRefile = { status: "replaced"; webUrl: string } | { status: "gone" } | { status: "failed" };

/**
 * Put a new copy of a version's Word file over the one already in OneDrive (same file, same link), so a
 * removed screen leaves it. "gone": the file was deleted there, so nothing still shows the screen.
 * "failed": OneDrive could not be reached or refused; the old file still shows the screen.
 */
export async function refileSopDocx(opts: { itemId: string; docx: Buffer; userId: string }): Promise<SopRefile> {
  const access = await driveAccess(opts.userId);
  if (!access) return { status: "failed" };
  try {
    const item = await replaceDriveItemContent(access.driveId, opts.itemId, new Uint8Array(opts.docx).buffer, access.token);
    return item ? { status: "replaced", webUrl: item.webUrl } : { status: "gone" };
  } catch (e) {
    console.error("SOP OneDrive re-file failed:", (e as Error).message);
    return { status: "failed" };
  }
}

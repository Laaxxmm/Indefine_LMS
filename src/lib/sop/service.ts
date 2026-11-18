import { z } from "zod";
import type { Session } from "next-auth";
import type { Department, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { levelLabel } from "@/lib/ca-firm";
import { logAudit } from "@/lib/audit/log";
import { failureSentence } from "@/lib/errors";
import { generateSop, stripBriefSecrets, stripSecrets } from "./gemini";
import { renderSopDocx } from "./render";
import { carryScreens, screenIds } from "./screens";
import { refileSopDocx, saveSopDocxToOneDrive } from "./storage";
import { MAX_SUB_PROCESSES, type SopBrief, type SopContent } from "./types";

const DEPTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "SOP";

export function normDept(d: string): Department {
  return (DEPTS.includes(d) ? d : "GENERAL") as Department;
}

// Shape of a (user-confirmed, possibly edited) brief posted from the client.
// Bounded: every field is fed to Gemini.
const line = z.string().max(2_000);
export const incomingBriefZ = z.object({
  title: z.string().min(1).max(300),
  department: z.string().max(40),
  workCategory: line.default(""),
  objective: z.string().max(10_000).default(""),
  scope: z.string().max(10_000).default(""),
  keySteps: z.array(line).max(200).default([]),
  rolesInvolved: z.array(line).max(100).default([]),
  references: z.array(line).max(100).default([]),
  subProcesses: z.array(line).max(MAX_SUB_PROCESSES).default([]),
});
export const createBodyZ = z.object({ brief: incomingBriefZ, rawProcedure: z.string().min(10).max(50_000), purpose: z.string().max(10_000).default("") });

/**
 * The response for a failed AI step (analyze or generate). The leak gate's refusal is the author's to
 * fix (422, "remove the client details"), never "try again in a minute"; anything else is 502.
 */
export function aiFailure(e: unknown, what: string, next: string): { body: { error: string }; status: number } {
  return { body: { error: failureSentence(e, what, next) }, status: (e as { name?: unknown } | null)?.name === "LegacyGateError" ? 422 : 502 };
}

// The signed-in user as a version author (name + designation from their level).
export async function resolveCreator(user: Session["user"]): Promise<{ id: string; name: string; designation: string }> {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { level: true } });
  return { id: user.id, name: user.name ?? "Unknown", designation: me ? levelLabel(me.level) : "" };
}

// The Word file for a version, with its screenshots. `sopId` keeps it to that SOP's images; a removed
// screen is left out (its picture is blank).
export async function renderVersionDocx(content: SopContent, sopId?: string): Promise<Buffer> {
  const ids = screenIds(content);
  const images = ids.length
    ? await prisma.sopImage.findMany({ where: { id: { in: ids }, removedAt: null, ...(sopId ? { sopId } : {}) }, select: { id: true, mime: true, bytes: true, width: true, height: true } })
    : [];
  return renderSopDocx(content, new Map(images.map((i) => [i.id, i])));
}

/** The SOP's removed screens: id → when it was removed. */
export async function removedScreens(sopId: string): Promise<Map<string, Date>> {
  const rows = await prisma.sopImage.findMany({ where: { sopId, removedAt: { not: null } }, select: { id: true, removedAt: true } });
  return new Map(rows.map((r) => [r.id, r.removedAt as Date]));
}

/** Ids of the SOP's removed screens. */
export async function removedScreenIds(sopId: string): Promise<Set<string>> {
  return new Set((await removedScreens(sopId)).keys());
}

/**
 * May this version's Word file in OneDrive still show a removed screen? It is in OneDrive and one of its
 * screens was removed after the file was last written (or the file predates graphFiledAt).
 */
export function staleInOneDrive(v: { graphItemId: string | null; graphFiledAt: Date | null; content: unknown }, removed: ReadonlyMap<string, Date>): boolean {
  if (!v.graphItemId || !removed.size) return false;
  return screenIds(v.content as SopContent).some((id) => {
    const at = removed.get(id);
    return !!at && (!v.graphFiledAt || at.getTime() > v.graphFiledAt.getTime());
  });
}

export const versionString = (title: string, versionNumber: number) => `${slug(title)}_Ver_${new Date().toISOString().slice(0, 10)}-${String(versionNumber).padStart(2, "0")}`;

// Add a version on top of `baseVersionId` and make it current. The SOP row is locked while the
// latest version is checked and the new one inserted, so two saves made from the same version
// cannot both land: the later one gets null (show a 409 and ask for a reload). The new version is
// audited in the same transaction (`action`, e.g. "sop.version-create").
export async function addVersion(
  sopId: string,
  baseVersionId: string | null,
  data: Omit<Prisma.SopVersionUncheckedCreateInput, "sopId">,
  sop: Prisma.SopUpdateInput = {},
  action = "sop.version-create",
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Sop" WHERE id = ${sopId} FOR UPDATE`;
    const top = await tx.sopVersion.findFirst({ where: { sopId }, orderBy: { versionNumber: "desc" }, select: { id: true } });
    if ((top?.id ?? null) !== baseVersionId) return null;
    const { id } = await tx.sopVersion.create({ data: { ...data, sopId }, select: { id: true } });
    await tx.sop.update({ where: { id: sopId }, data: { ...sop, currentVersionId: id } });
    await logAudit(tx, { actorId: data.createdById, action, entity: "SopVersion", entityId: id, meta: { sopId, versionNumber: data.versionNumber, screens: screenIds(data.content as unknown as SopContent).length } });
    return id;
  });
}

// Remember a folder this save made, unless another save already recorded one; then use theirs.
// ponytail: the losing save's new folder stays empty in OneDrive (two first saves at once); delete it if that is ever seen.
async function claimFolder(sopId: string, seen: string | null, made: string): Promise<string> {
  const won = await prisma.sop.updateMany({ where: { id: sopId, graphFolderId: seen }, data: { graphFolderId: made } });
  if (won.count) return made;
  return (await prisma.sop.findUnique({ where: { id: sopId }, select: { graphFolderId: true } }))?.graphFolderId ?? made;
}

// Put a saved version's Word file (with its live screens) in the SOP's OneDrive folder and record the
// link on the version. A version already filed gets its file replaced in place (same link); one whose
// file was deleted there is filed again. Every try is audited. Returns the link, or null on failure.
export async function fileToOneDrive(sopId: string, versionId: string, userId: string): Promise<string | null> {
  const [sop, version] = await Promise.all([
    prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, department: true, graphFolderId: true } }),
    prisma.sopVersion.findFirst({ where: { id: versionId, sopId }, select: { content: true, versionNumber: true, graphItemId: true, graphWebUrl: true } }),
  ]);
  if (!sop || !version) return null;
  const docx = await renderVersionDocx(version.content as unknown as SopContent, sopId);
  const record = (ok: boolean, how: string) => logAudit(prisma, { actorId: userId, action: "sop.onedrive-file", entity: "SopVersion", entityId: versionId, meta: { sopId, ok, how } });
  if (version.graphItemId) {
    const r = await refileSopDocx({ itemId: version.graphItemId, docx, userId });
    if (r.status === "replaced") {
      const webUrl = r.webUrl || version.graphWebUrl;
      await prisma.sopVersion.update({ where: { id: versionId }, data: { graphWebUrl: webUrl, graphFiledAt: new Date() } });
      await record(true, "replaced");
      return webUrl;
    }
    if (r.status === "failed") {
      await record(false, "replace");
      return null;
    }
    // "gone": the file was deleted in OneDrive; file a new one below.
  }
  const stored = await saveSopDocxToOneDrive({
    folderId: sop.graphFolderId,
    claimFolder: (made) => claimFolder(sopId, sop.graphFolderId, made),
    department: sop.department,
    title: sop.title,
    versionNumber: version.versionNumber,
    docx,
    userId,
  });
  if (!stored.itemId) {
    await record(false, "new");
    return null;
  }
  await prisma.sopVersion.update({ where: { id: versionId }, data: { graphItemId: stored.itemId, graphWebUrl: stored.webUrl, graphFiledAt: new Date() } });
  await record(true, "new");
  return stored.webUrl;
}

/** What a save route says when the SOP is saved but its Word file is not in OneDrive yet (SOP review L2). */
export const ONEDRIVE_LATER = "The SOP is saved, but its Word file could not be put in OneDrive yet. Open the SOP and use Save to OneDrive to try again.";

/** fileToOneDrive after a save: never throws, so a saved SOP is never reported as failed. */
export async function fileAfterSave(sopId: string, versionId: string, userId: string): Promise<{ webUrl: string | null; notice?: string }> {
  try {
    const webUrl = await fileToOneDrive(sopId, versionId, userId);
    return webUrl ? { webUrl } : { webUrl: null, notice: ONEDRIVE_LATER };
  } catch (e) {
    console.error("SOP OneDrive filing after save failed:", (e as Error).message);
    return { webUrl: null, notice: ONEDRIVE_LATER };
  }
}

const versionsPhrase = (nums: number[]) => {
  const list = nums.length > 1 ? `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}` : String(nums[0]);
  return `${nums.length > 1 ? "versions" : "version"} ${list}`;
};

export type RemoveScreenResult = { ok: true; message: string; refiled: number[]; flagged: number[] } | { ok: false; status: number; error: string };

/**
 * "Remove this screen" (SOP review H1; admins and partners, checked by the route). The picture is
 * blanked in place (UPDATE: empty bytes, removedAt) — never deleted — so every version, the page and
 * the Word download stop showing it. Each version whose Word file is in OneDrive is saved again
 * without it; a file OneDrive would not take is named in the answer, and the SOP page keeps flagging it
 * (staleInOneDrive) until it is filed again, so someone removes the picture there by hand. Repeating it
 * on a removed screen retries those files; so does Save to OneDrive on the version.
 */
export async function removeScreen(sopId: string, imageId: string, actorId: string): Promise<RemoveScreenResult> {
  const image = await prisma.sopImage.findFirst({ where: { id: imageId, sopId }, select: { id: true, removedAt: true } });
  if (!image) return { ok: false, status: 404, error: "That screen wasn't found. Reload the SOP page and try again." };
  const versions = await prisma.sopVersion.findMany({ where: { sopId }, orderBy: { versionNumber: "asc" }, select: { id: true, versionNumber: true, content: true, graphItemId: true, graphFiledAt: true } });
  const showing = versions.filter((v) => screenIds(v.content as unknown as SopContent).includes(imageId));
  const removedAt = image.removedAt ?? new Date();
  if (!image.removedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.sopImage.update({ where: { id: imageId }, data: { bytes: new Uint8Array(0), removedAt, removedById: actorId } });
      await logAudit(tx, { actorId, action: "sop.screen-remove", entity: "SopImage", entityId: imageId, meta: { sopId, versions: showing.map((v) => v.versionNumber) } });
    });
  }
  const refiled: number[] = [];
  const flagged: number[] = [];
  const removed = new Map([[imageId, removedAt]]);
  for (const v of showing.filter((x) => staleInOneDrive(x, removed))) {
    let webUrl: string | null = null;
    try {
      webUrl = await fileToOneDrive(sopId, v.id, actorId);
    } catch (e) {
      console.error(`SOP ${sopId} v${v.versionNumber}: re-filing after a screen removal failed:`, (e as Error).message);
    }
    if (webUrl) refiled.push(v.versionNumber);
    else flagged.push(v.versionNumber);
  }
  const parts = [image.removedAt ? "This screen was already removed from every version of this SOP." : "The screen is removed: its picture is blanked in every version of this SOP and in the Word downloads."];
  if (refiled.length) parts.push(`The Word ${refiled.length > 1 ? "files" : "file"} of ${versionsPhrase(refiled)} in OneDrive ${refiled.length > 1 ? "were" : "was"} saved again without it. OneDrive keeps the earlier copy in each file's version history: delete it there too.`);
  if (flagged.length) parts.push(`The Word ${flagged.length > 1 ? "files" : "file"} of ${versionsPhrase(flagged)} in OneDrive could not be saved again and still ${flagged.length > 1 ? "show" : "shows"} the screen. Open ${flagged.length > 1 ? "each one" : "it"} in OneDrive and delete the picture by hand, or use Save to OneDrive on ${flagged.length > 1 ? "each version" : "that version"} later.`);
  return { ok: true, message: parts.join(" "), refiled, flagged };
}

// Generate a version's structured content and return a ready-to-persist SopVersion payload
// (minus sopId). Shared by create + edit; an edit passes the last version, whose live screens carry
// over. The Word file goes to OneDrive after the row is saved (fileAfterSave).
export async function buildVersion(opts: {
  brief: SopBrief;
  rawProcedure: string;
  purpose: string;
  versionNumber: number;
  revision: string;
  creator: { id: string; name: string; designation: string };
  previous?: SopContent;
}): Promise<Omit<Prisma.SopVersionUncheckedCreateInput, "sopId">> {
  const effectiveDate = new Date().toLocaleDateString("en-GB"); // DD/MM/YYYY
  // A credential typed into any field is never sent to the AI and never stored.
  const rawProcedure = stripSecrets(opts.rawProcedure);
  const purpose = stripSecrets(opts.purpose);
  const brief = stripBriefSecrets(opts.brief);
  const preparedBy = [opts.creator.name, opts.creator.designation].filter(Boolean).join(", ");
  const generated = { ...(await generateSop(brief, rawProcedure, { effectiveDate, revision: opts.revision })), preparedBy };
  const content = carryScreens(opts.previous, generated);
  return {
    versionNumber: opts.versionNumber,
    versionString: versionString(brief.title, opts.versionNumber),
    purpose,
    rawProcedure,
    brief: brief as unknown as Prisma.InputJsonValue,
    content: content as unknown as Prisma.InputJsonValue,
    createdById: opts.creator.id,
    creatorName: opts.creator.name,
    creatorDesignation: opts.creator.designation,
  };
}

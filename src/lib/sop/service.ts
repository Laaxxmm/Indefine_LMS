import { z } from "zod";
import type { Session } from "next-auth";
import type { Department, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { levelLabel } from "@/lib/ca-firm";
import { generateSop, stripBriefSecrets, stripSecrets } from "./gemini";
import { renderSopDocx } from "./render";
import { carryScreens, screenIds } from "./screens";
import { saveSopDocxToOneDrive } from "./storage";
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

// The signed-in user as a version author (name + designation from their level).
export async function resolveCreator(user: Session["user"]): Promise<{ id: string; name: string; designation: string }> {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { level: true } });
  return { id: user.id, name: user.name ?? "Unknown", designation: me ? levelLabel(me.level) : "" };
}

// The Word file for a version, with its screenshots. `sopId` keeps it to that SOP's images.
export async function renderVersionDocx(content: SopContent, sopId?: string): Promise<Buffer> {
  const ids = screenIds(content);
  const images = ids.length
    ? await prisma.sopImage.findMany({ where: { id: { in: ids }, ...(sopId ? { sopId } : {}) }, select: { id: true, mime: true, bytes: true, width: true, height: true } })
    : [];
  return renderSopDocx(content, new Map(images.map((i) => [i.id, i])));
}

export const versionString = (title: string, versionNumber: number) => `${slug(title)}_Ver_${new Date().toISOString().slice(0, 10)}-${String(versionNumber).padStart(2, "0")}`;

// Add a version on top of `baseVersionId` and make it current. The SOP row is locked while the
// latest version is checked and the new one inserted, so two saves made from the same version
// cannot both land: the later one gets null (show a 409 and ask for a reload).
export async function addVersion(sopId: string, baseVersionId: string | null, data: Omit<Prisma.SopVersionUncheckedCreateInput, "sopId">, sop: Prisma.SopUpdateInput = {}): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Sop" WHERE id = ${sopId} FOR UPDATE`;
    const top = await tx.sopVersion.findFirst({ where: { sopId }, orderBy: { versionNumber: "desc" }, select: { id: true } });
    if ((top?.id ?? null) !== baseVersionId) return null;
    const { id } = await tx.sopVersion.create({ data: { ...data, sopId }, select: { id: true } });
    await tx.sop.update({ where: { id: sopId }, data: { ...sop, currentVersionId: id } });
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

// Put a saved version's Word file (with its screens) in the SOP's OneDrive folder and record the
// link on the version. Best-effort: on failure the version has no link and the SOP page offers
// "Save to OneDrive". Returns the link, or null.
export async function fileToOneDrive(sopId: string, versionId: string, userId: string): Promise<string | null> {
  const [sop, version] = await Promise.all([
    prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, department: true, graphFolderId: true } }),
    prisma.sopVersion.findFirst({ where: { id: versionId, sopId }, select: { content: true, versionNumber: true } }),
  ]);
  if (!sop || !version) return null;
  const docx = await renderVersionDocx(version.content as unknown as SopContent, sopId);
  const stored = await saveSopDocxToOneDrive({
    folderId: sop.graphFolderId,
    claimFolder: (made) => claimFolder(sopId, sop.graphFolderId, made),
    department: sop.department,
    title: sop.title,
    versionNumber: version.versionNumber,
    docx,
    userId,
  });
  if (!stored.itemId) return null;
  await prisma.sopVersion.update({ where: { id: versionId }, data: { graphItemId: stored.itemId, graphWebUrl: stored.webUrl } });
  return stored.webUrl;
}

// Generate a version's structured content and return a ready-to-persist SopVersion payload
// (minus sopId). Shared by create + edit; an edit passes the last version, whose screens carry
// over. The Word file goes to OneDrive after the row is saved (fileToOneDrive).
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

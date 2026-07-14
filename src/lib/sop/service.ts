import { z } from "zod";
import type { Session } from "next-auth";
import type { Department, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { levelLabel } from "@/lib/ca-firm";
import { generateSop } from "./gemini";
import { renderSopDocx } from "./render";
import { saveSopDocxToOneDrive } from "./storage";
import type { SopBrief } from "./types";

const DEPTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "SOP";

export function normDept(d: string): Department {
  return (DEPTS.includes(d) ? d : "GENERAL") as Department;
}

// Shape of a (user-confirmed, possibly edited) brief posted from the client.
export const incomingBriefZ = z.object({
  title: z.string().min(1),
  department: z.string(),
  workCategory: z.string().default(""),
  objective: z.string().default(""),
  scope: z.string().default(""),
  keySteps: z.array(z.string()).default([]),
  rolesInvolved: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});
export const createBodyZ = z.object({ brief: incomingBriefZ, rawProcedure: z.string().min(10), purpose: z.string().default("") });

// The signed-in user as a version author (name + designation from their level).
export async function resolveCreator(user: Session["user"]): Promise<{ id: string; name: string; designation: string }> {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { level: true } });
  return { id: user.id, name: user.name ?? "Unknown", designation: me ? levelLabel(me.level) : "" };
}

// Generate a version's structured content + .docx, push the .docx to OneDrive (best-effort),
// and return a ready-to-persist SopVersion payload (minus sopId). Shared by create + edit.
export async function buildVersion(opts: {
  brief: SopBrief;
  rawProcedure: string;
  purpose: string;
  versionNumber: number;
  revision: string;
  creator: { id: string; name: string; designation: string };
}): Promise<Omit<Prisma.SopVersionCreateManyInput, "sopId">> {
  const now = new Date();
  const effectiveDate = now.toLocaleDateString("en-GB"); // DD/MM/YYYY
  const content = await generateSop(opts.brief, opts.rawProcedure, { effectiveDate, revision: opts.revision });
  const docx = await renderSopDocx(content);
  const stored = await saveSopDocxToOneDrive({ department: opts.brief.department, title: opts.brief.title, versionNumber: opts.versionNumber, docx, userId: opts.creator.id });
  const versionString = `${slug(opts.brief.title)}_Ver_${now.toISOString().slice(0, 10)}-${String(opts.versionNumber).padStart(2, "0")}`;
  return {
    versionNumber: opts.versionNumber,
    versionString,
    purpose: opts.purpose,
    rawProcedure: opts.rawProcedure,
    brief: opts.brief as unknown as Prisma.InputJsonValue,
    content: content as unknown as Prisma.InputJsonValue,
    graphItemId: stored?.itemId ?? null,
    graphWebUrl: stored?.webUrl ?? null,
    createdById: opts.creator.id,
    creatorName: opts.creator.name,
    creatorDesignation: opts.creator.designation,
  };
}

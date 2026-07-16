import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { toolById } from "./registry";

// Record who ran which tool, when, and a one-line summary. Best-effort — a failed
// audit write must never block the user's download. No file is stored (§no-storing).
export async function recordToolRun(user: Session["user"], toolId: string, summary: string): Promise<void> {
  const meta = toolById(toolId);
  if (!meta) return;
  await prisma.officeToolRun
    .create({
      data: {
        tool: meta.id,
        toolTitle: meta.title,
        category: meta.category,
        format: meta.format,
        summary: summary.slice(0, 200),
        createdById: user.id,
        createdByName: user.name ?? "Unknown",
      },
    })
    .catch(() => {});
}

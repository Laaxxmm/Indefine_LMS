import { nextTaskDeps } from "@/lib/companion/defaults";
import { handleNextTask, handlePreflight } from "@/lib/companion/http";
import { allowedExtensionOrigins } from "@/lib/companion/config";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

export const dynamic = "force-dynamic";

// The Firm OS Companion side panel's only call: the signed-in person's current task, read-only.
// Auth is the pairing token (Authorization: Bearer), never a cookie. Nothing here writes to a job;
// the only write is CompanionToken.lastUsedAt.
export async function GET(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  return handleNextTask(req, nextTaskDeps());
}

export async function OPTIONS(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  return handlePreflight(req, allowedExtensionOrigins());
}

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadCorrectionHistory } from "@/lib/corrections/history";
import { idZ, parse, signedIn, toJson } from "@/lib/corrections/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

const queryZ = z.object({ entity: z.string().trim().min(1, "Choose what kind of record to show.").max(40), id: idZ });

// Correction history of one record (who, when, field, before → after, reason) and the fields the
// signed-in person may correct on it. Read-only.
export async function GET(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const s = await signedIn();
  if (!s.ok) return s.res;
  const url = new URL(req.url);
  const q = parse(queryZ, { entity: url.searchParams.get("entity") ?? "", id: url.searchParams.get("id") ?? "" });
  if (!q.ok) return q.res;
  return toJson(await loadCorrectionHistory(s.user, q.data, { db: prisma }));
}

import { prisma } from "@/lib/prisma";
import { saveUserSetting, type AdminWorkspaceDb } from "@/lib/workspace/admin";
import { adminUser, readBody, toJson, userSettingZ } from "@/lib/workspace/http";

// Save one person's workspace (their own modules or "follow the role", focus mode, companion
// extension allowed). Admins only; the row and its AuditEvent are written in one transaction.
// "Reset to role default" is a save of nulls, never a removal.
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await adminUser();
  if (g.res) return g.res;
  const body = await readBody(userSettingZ, req);
  if (body.res) return body.res;
  const { userId } = await params;
  return toJson(await saveUserSetting(g.user, userId, body.data, prisma as unknown as AdminWorkspaceDb));
}

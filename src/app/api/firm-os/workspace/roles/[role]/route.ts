import { prisma } from "@/lib/prisma";
import { saveRoleDefault, type AdminWorkspaceDb } from "@/lib/workspace/admin";
import { adminUser, readBody, roleDefaultZ, toJson } from "@/lib/workspace/http";

// Save a role's default modules and focus mode (/admin/firm-os/workspace). Admins only; the row
// and its AuditEvent are written in one transaction.
export async function POST(req: Request, { params }: { params: Promise<{ role: string }> }) {
  const g = await adminUser();
  if (g.res) return g.res;
  const body = await readBody(roleDefaultZ, req);
  if (body.res) return body.res;
  const { role } = await params;
  return toJson(await saveRoleDefault(g.user, role, body.data, prisma as unknown as AdminWorkspaceDb));
}

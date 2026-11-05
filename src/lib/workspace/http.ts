// Route-handler plumbing for /api/firm-os/workspace/**: auth → zod → one lib call → JSON. Error
// texts are plain sentences (what is wrong, what to do); no codes in what a person reads.
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z, type ZodSchema } from "zod";
import { auth } from "@/lib/auth";
import { canManageWorkspace } from "@/lib/rbac/policy";
import { ADMIN_ONLY, type AdminResult } from "./admin";
import { MODULE_KEYS } from "./registry";

export const SIGN_IN = "Your session has ended. Sign in again to continue.";
const UNREADABLE = "The settings could not be read. Reload the page and try again.";

export type Signed = { user: Session["user"]; res?: undefined } | { user?: undefined; res: NextResponse };

export async function signedInUser(): Promise<Signed> {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: SIGN_IN }, { status: 401 }) };
  return { user: session.user };
}

export async function adminUser(): Promise<Signed> {
  const s = await signedInUser();
  if (s.res) return s;
  if (!canManageWorkspace(s.user)) return { res: NextResponse.json({ error: ADMIN_ONLY }, { status: 403 }) };
  return s;
}

const moduleList = z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length * 2);
export const roleDefaultZ = z.object({ modules: moduleList, focusMode: z.boolean() }).strict();
export const userSettingZ = z.object({ modules: moduleList.nullable(), focusMode: z.boolean().nullable(), companionEnabled: z.boolean() }).strict();

export async function readBody<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? { data: parsed.data } : { res: NextResponse.json({ error: UNREADABLE }, { status: 400 }) };
}

export function toJson<T>(r: AdminResult<T>): NextResponse {
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

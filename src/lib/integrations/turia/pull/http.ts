// Route plumbing for /api/firm-os/turia-sync/**: session -> policy -> capped JSON body -> zod ->
// one lib call -> JSON. Same-site protection is the existing one: the NextAuth session cookie
// (SameSite=Lax) plus a JSON body, which a form on another site cannot send. Plain sentences only.
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { ZodSchema } from "zod";
import { auth } from "@/lib/auth";
import { readJsonCapped } from "@/lib/hardening/json-body";
import { canManageTuriaSync } from "@/lib/rbac/policy";
import { MANAGERS_ONLY, type AdminResult } from "./admin";

export const SIGN_IN_MESSAGE = "Your session has ended. Sign in again to continue.";
const UNREADABLE = "The change could not be read. Reload the page and try again.";

export type Manager = { user: NonNullable<Session["user"]>; res?: undefined } | { user?: undefined; res: NextResponse };

/** The signed-in admin or partner, or the 401 / 403 to send. */
export async function turiaSyncManager(): Promise<Manager> {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: SIGN_IN_MESSAGE }, { status: 401 }) };
  if (!canManageTuriaSync(session.user)) return { res: NextResponse.json({ error: MANAGERS_ONLY }, { status: 403 }) };
  return { user: session.user };
}

/** The body checked against `schema`; a field's own sentence when the schema has one. */
export async function readTuriaSyncBody<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const body = await readJsonCapped(req);
  if (!body.ok) return { res: body.res };
  const parsed = schema.safeParse(body.value);
  if (parsed.success) return { data: parsed.data };
  const custom = parsed.error.issues.find((i) => i.code === "too_small" || i.code === "too_big")?.message;
  return { res: NextResponse.json({ error: custom && /\s/.test(custom) && /^[A-Z]/.test(custom) ? custom : UNREADABLE }, { status: 400 }) };
}

export function turiaSyncJson<T>(r: AdminResult<T>): NextResponse {
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

// Route plumbing for /api/firm-os/coach/**: auth → zod → one coach call → JSON
// (docs/ARCHITECTURE.md §10). Every route acts on the signed-in person's own data only.
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActive } from "@/lib/access";
import type { CoachResult } from "./activity";

export type Guarded = { user: Session["user"]; res?: undefined } | { user?: undefined; res: NextResponse };

/** Signed in and active, or a 401 / 403 response. */
export async function requireCoachUser(): Promise<Guarded> {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isActive(session.user)) return { res: NextResponse.json({ error: "Your account is inactive" }, { status: 403 }) };
  return { user: session.user };
}

export const eventIdZ = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid notice id");

export const preferencesZ = z
  .object({
    breakNudges: z.boolean().optional(),
    morningBoard: z.boolean().optional(),
    snoozeMinutes: z.number().int("Snooze minutes must be a whole number").min(0).max(24 * 60).optional(),
  })
  .strict();

/**
 * The heartbeat takes no data (ADR-006): an empty body or {} only. Anything else is refused, so no
 * page can start sending what someone is looking at.
 */
export async function emptyBody(req: Request): Promise<boolean> {
  const text = (await req.text().catch(() => "")).trim();
  if (text === "") return true;
  try {
    const v: unknown = JSON.parse(text);
    return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
  } catch {
    return false;
  }
}

export async function parseBody<T>(schema: z.ZodType<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 }) };
}

export function toJson<T>(r: CoachResult<T>): NextResponse {
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

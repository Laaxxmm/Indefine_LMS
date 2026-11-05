// Route plumbing for /api/firm-os/coach/**: auth → policy → zod → one coach call → JSON
// (docs/ARCHITECTURE.md §10). Every route acts on the signed-in person's own data only. Who may
// use the coach is src/lib/rbac/policy.ts (canUseCoach, canManageOwnCoachPrefs).
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageOwnCoachPrefs, canUseCoach } from "@/lib/rbac/policy";
import type { CoachResult } from "./activity";
import { USER_MESSAGES, validationMessage } from "@/lib/errors";

export type Guarded = { user: Session["user"]; res?: undefined } | { user?: undefined; res: NextResponse };
export type OwnerGuarded = { user: Session["user"]; ownerId: string; res?: undefined } | { user?: undefined; ownerId?: undefined; res: NextResponse };

const INACTIVE = "Your account is inactive. Ask an admin if you think this is wrong.";

/** Signed in and allowed to use the coach (canUseCoach: active), or a 401 / 403 response. */
export async function requireCoachUser(): Promise<Guarded> {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: USER_MESSAGES.signIn() }, { status: 401 }) };
  if (!canUseCoach(session.user)) return { res: NextResponse.json({ error: INACTIVE }, { status: 403 }) };
  return { user: session.user };
}

/**
 * For routes that change the person's own coach settings: the owner of the row written is always
 * the signed-in person (never an id from the request), and canManageOwnCoachPrefs must agree.
 */
export async function requireOwnCoachUser(): Promise<OwnerGuarded> {
  const g = await requireCoachUser();
  if (g.res) return g;
  const ownerId = g.user.id;
  if (!canManageOwnCoachPrefs(g.user, ownerId)) return { res: NextResponse.json({ error: INACTIVE }, { status: 403 }) };
  return { user: g.user, ownerId };
}

export const eventIdZ = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "That notice could not be found. Reload the page and try again.");

export const preferencesZ = z
  .object({
    breakNudges: z.boolean().optional(),
    morningBoard: z.boolean().optional(),
    snoozeMinutes: z.number().int("Enter the snooze time as a whole number of minutes.").min(0).max(24 * 60).optional(),
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
  return { res: NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 }) };
}

export function toJson<T>(r: CoachResult<T>): NextResponse {
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

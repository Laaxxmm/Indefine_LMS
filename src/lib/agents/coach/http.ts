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
import { readJsonCapped } from "@/lib/hardening/json-body";
import { readBodyCapped } from "@/lib/hardening/uploads";

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

/** The heartbeat body is empty or {}; it is read no further than this (the rest is never pulled from the stream). */
export const HEARTBEAT_MAX_BYTES = 1024;
/** The preferences body is three small fields. */
export const PREFERENCES_MAX_BYTES = 4 * 1024;

const NOT_EMPTY = "This check-in from the page should carry nothing, so it was refused. Reload the page.";
const HEARTBEAT_TOO_LARGE = "This check-in from the page should carry nothing, and it was far too large, so it was refused. Reload the page.";

/**
 * The heartbeat takes no data (ADR-006): an empty body or {} only. Anything else is refused (400), so
 * no page can start sending what someone is looking at. The body is read with a running byte count
 * (readBodyCapped, src/lib/hardening/uploads.ts): past HEARTBEAT_MAX_BYTES it stops and answers 413,
 * whatever Content-Length says or leaves out. null means the body was empty or {}.
 */
export async function refuseNonEmptyBody(req: Request): Promise<NextResponse | null> {
  const body = await readBodyCapped(req, HEARTBEAT_MAX_BYTES).catch(() => null);
  if (!body) return NextResponse.json({ error: NOT_EMPTY }, { status: 400 });
  if (!body.ok) return NextResponse.json({ error: HEARTBEAT_TOO_LARGE }, { status: 413, headers: { "Cache-Control": "no-store" } });
  const text = new TextDecoder().decode(body.bytes).trim();
  if (text === "") return null;
  try {
    const v: unknown = JSON.parse(text);
    if (!!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return null;
  } catch {
    // not JSON: refused below
  }
  return NextResponse.json({ error: NOT_EMPTY }, { status: 400 });
}

/** A JSON body checked by `schema`, read with a running byte count (readJsonCapped): 413 past `maxBytes`, 400 when the schema refuses it. */
export async function parseBody<T>(schema: z.ZodType<T>, req: Request, maxBytes: number = PREFERENCES_MAX_BYTES): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const body = await readJsonCapped(req, maxBytes);
  if (!body.ok) return { res: body.res };
  const parsed = schema.safeParse(body.value);
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 }) };
}

export function toJson<T>(r: CoachResult<T>): NextResponse {
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

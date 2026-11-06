// HTTP edge of the /companion page's pairing routes (POST tokens, POST tokens/[id]/revoke):
// signed-in session, same origin, "auth → zod → one service call → JSON" (docs/ARCHITECTURE.md §10).
// Companion access itself is checked by the service (tokens.ts), so the rule lives in one place.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Session } from "next-auth";
import { isActive } from "@/lib/access";
import type { CompanionUser } from "./access";
import { COMPANION_LABEL_MAX } from "./config";
import { CompanionError } from "./errors";
import { MSG } from "./messages";

export const createPairingBodyZ = z.object({
  // Generous here; tokens.ts normaliseLabel enforces the real limit after trimming.
  label: z.string({ required_error: MSG.labelRequired, invalid_type_error: MSG.labelRequired }).max(COMPANION_LABEL_MAX * 2, MSG.labelTooLong),
});

export const pairingIdZ = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

type Guarded = { ok: true; user: CompanionUser } | { ok: false; res: Response };

/** 401 when signed out, 403 when the account is inactive. */
export function sessionGuard(session: Session | null): Guarded {
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: MSG.signedOut }, { status: 401 }) };
  if (!isActive(session.user)) return { ok: false, res: NextResponse.json({ error: MSG.accountInactive }, { status: 403 }) };
  return { ok: true, user: session.user };
}

/** Parse with a schema; 400 with the schema's own sentence, or a general one for zod's defaults. */
export function parseOr400<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; res: Response } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const message = parsed.error.issues[0]?.message ?? "";
  const ours = (Object.values(MSG) as string[]).includes(message);
  return { ok: false, res: NextResponse.json({ error: ours ? message : MSG.badRequest }, { status: 400 }) };
}

/** CompanionError → its status and sentence; anything else → 500 with a plain sentence (details logged). */
export function pairingErrorResponse(e: unknown): Response {
  if (e instanceof CompanionError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[companion] pairing request failed", e);
  return NextResponse.json({ error: MSG.saveFailed }, { status: 500 });
}

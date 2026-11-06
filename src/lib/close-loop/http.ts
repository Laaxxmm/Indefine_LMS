// HTTP edge for /api/firm-os/jobs/[id]/*: request schemas, the sign-in guard and error → status
// mapping. Routes stay "auth → zod → one lib call → JSON" (docs/ARCHITECTURE.md §10). Per-job
// access (assignee / reviewer / manager / partner) is decided in actions.ts, which loads the job.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Session } from "next-auth";
import { isActive } from "@/lib/access";
import { JOB_TASK_STATES } from "@/lib/agents/core/state";
import { TuriaConfirmError } from "@/lib/integrations/turia/errors";
import { USER_MESSAGES, validationMessage } from "@/lib/errors";
import { CloseLoopError } from "./errors";

export const jobIdZ = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "That job link is not complete. Open the job again from your list.");

export const filedBodyZ = z.object({
  ackRef: z.string().trim().max(64, "Acknowledgement reference is at most 64 characters").nullable().optional(),
  turiaTaskRef: z.string().trim().min(1).max(100).nullable().optional(),
  minutes: z.number().int().min(1).max(6000).nullable().optional(),
});

export const turiaCloseBodyZ = z.object({
  turiaTaskRef: z.string({ required_error: "Enter the Turia task ref" }).trim().min(1, "Enter the Turia task ref").max(100),
  minutes: z
    .number({ required_error: "Enter the minutes logged in Turia", invalid_type_error: "Minutes must be a number" })
    .int("Minutes must be a whole number")
    .min(1, "Minutes logged must be more than 0")
    .max(6000, "Minutes must be at most 6,000"),
});

const stateZ = z.enum(JOB_TASK_STATES);
export const stateBodyZ = z.object({ to: stateZ, expectedState: stateZ, note: z.string().trim().max(2000).nullable().optional() });

type Guarded = { ok: true; user: Session["user"] } | { ok: false; res: NextResponse };

/** 401 when signed out, 403 when the account is inactive. */
export function guard(session: Session | null): Guarded {
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: USER_MESSAGES.signIn() }, { status: 401 }) };
  if (!isActive(session.user)) return { ok: false, res: NextResponse.json({ error: USER_MESSAGES.inactive() }, { status: 403 }) };
  return { ok: true, user: session.user };
}

/** Parse with a schema; 400 with the first message on failure. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; res: NextResponse } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, res: NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 }) };
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

const STATUS: Record<string, number> = {
  "not-found": 404,
  forbidden: 403,
  "gate-required": 403,
  invalid: 400,
  conflict: 409,
  state: 409,
};

/** Known failures become a JSON error with the right status; anything else is rethrown (500). */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof CloseLoopError || e instanceof TuriaConfirmError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] ?? 400 });
  }
  throw e;
}

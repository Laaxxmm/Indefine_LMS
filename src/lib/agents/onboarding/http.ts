// HTTP edge for /api/firm-os/onboard/*: request schemas, the auth guard and error → status
// mapping. Routes stay "auth → zod → one lib call → JSON" (docs/ARCHITECTURE.md §10).
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Session } from "next-auth";
import { BudgetExceededError } from "@/lib/ai/errors";
import { TuriaConfirmError } from "@/lib/integrations/turia/errors";
import { canOnboard, firmRole } from "@/lib/rbac/policy";
import { SagaError } from "./saga";
import { OnboardingError } from "./service";

export const runIdZ = z.string().trim().min(1).max(64);

export const startBodyZ = z.object({
  prompt: z.string().trim().min(5, "Describe the client in a sentence").max(2000, "Keep it under 2,000 characters"),
});

export const answerBodyZ = z
  .object({
    runId: runIdZ,
    answers: z.record(z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)])).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((b) => (b.answers && Object.keys(b.answers).length > 0) || !!b.message, "Answer at least one question");

export const runBodyZ = z.object({ runId: runIdZ });

export const turiaConfirmBodyZ = z.object({
  runId: runIdZ,
  syncId: z.string().trim().min(1).max(64),
  turiaRef: z.string().trim().min(1, "Enter the Turia reference").max(100),
  minutes: z.number().int().min(1).max(6000).nullable().optional(),
});

type Guarded = { ok: true; user: Session["user"]; isPartner: boolean } | { ok: false; res: NextResponse };

/** 401 when signed out, 403 unless partner/manager/admin (src/lib/rbac/policy.ts). */
export function guard(session: Session | null): Guarded {
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canOnboard(session.user)) return { ok: false, res: NextResponse.json({ error: "Only partners and managers can onboard clients" }, { status: 403 }) };
  return { ok: true, user: session.user, isPartner: firmRole(session.user) === "partner" };
}

/** Parse a JSON body with a schema; 400 with the first message on failure. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, res: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 }) };
}

const STATUS: Record<string, number> = { "not-found": 404, conflict: 409, busy: 409, "not-confirmed": 409, invalid: 400, restricted: 409 };

/** Known failures become a JSON error with the right status; anything else is rethrown (500). */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof OnboardingError || e instanceof SagaError || e instanceof TuriaConfirmError) {
    return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
  }
  if (e instanceof BudgetExceededError) {
    return NextResponse.json({ error: "The AI budget for today is used up. Answer the questions by hand or try tomorrow." }, { status: 503 });
  }
  throw e;
}

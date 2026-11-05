// Route-handler plumbing for /api/firm-os/agents/**: auth → zod → one service call → JSON.
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { ZodSchema } from "zod";
import { auth } from "@/lib/auth";
import { canUseAgents } from "@/lib/agents/access";
import type { ServiceResult } from "@/lib/agents/service";
import { USER_MESSAGES, validationMessage } from "@/lib/errors";

export type Guarded = { user: Session["user"]; res?: undefined } | { user?: undefined; res: NextResponse };

/** Signed in and active, or a 401 / 403 response. */
export async function requireAgentUser(): Promise<Guarded> {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: USER_MESSAGES.signIn() }, { status: 401 }) };
  if (!canUseAgents(session.user)) return { res: NextResponse.json({ error: USER_MESSAGES.noAgentAccess() }, { status: 403 }) };
  return { user: session.user };
}

export async function parseJson<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 }) };
}

export function toJson<T>(r: ServiceResult<T>, okStatus = 200): NextResponse {
  if (r.ok) return NextResponse.json(r.data, { status: okStatus });
  // 503 from a full agent-run queue: tell the client when to try again.
  if (r.retryAfterSec !== undefined) return NextResponse.json({ error: r.error, retryAfter: r.retryAfterSec }, { status: r.status, headers: { "Retry-After": String(r.retryAfterSec) } });
  return NextResponse.json({ error: r.error }, { status: r.status });
}

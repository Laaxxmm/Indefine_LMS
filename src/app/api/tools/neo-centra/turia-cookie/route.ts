import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { TuriaSessionError, storeTuriaCookie, turiaStatus } from "@/lib/neo-centra/turia";
import { bearerUnauthorized } from "@/lib/cron-auth";

// Store / inspect the firm's Turia session cookie. Two callers:
//  - a director in the LMS (session-gated), pasting the cookie manually, or
//  - the browser extension, sending `Authorization: Bearer <NEO_TURIA_RELAY_TOKEN>`
//    (the service worker can't carry the LMS session cookie cross-origin).
// The relay token is compared in constant time (bearerUnauthorized).
export async function POST(req: NextRequest) {
  let byId: string | undefined;
  let byName: string | undefined = "Turia extension";
  if (bearerUnauthorized(req, process.env.NEO_TURIA_RELAY_TOKEN)) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    byId = session.user.id;
    byName = session.user.name ?? undefined;
  }

  const parsed = z.object({ cookie: z.string().min(10).max(16_384) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A cookie string is required" }, { status: 400 });

  try {
    await storeTuriaCookie(parsed.data.cookie, byId, byName);
  } catch (e) {
    if (e instanceof TuriaSessionError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  return NextResponse.json(await turiaStatus());
}

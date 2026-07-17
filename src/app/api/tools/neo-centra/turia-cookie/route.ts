import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { storeTuriaCookie, turiaStatus } from "@/lib/neo-centra/turia";

// Store / inspect the firm's Turia session cookie. Two callers:
//  - a director in the LMS (session-gated), pasting the cookie manually, or
//  - the browser extension, sending `Authorization: Bearer <NEO_TURIA_RELAY_TOKEN>`
//    (the service worker can't carry the LMS session cookie cross-origin).
function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
function relayAuthorized(req: Request): boolean {
  const token = process.env.NEO_TURIA_RELAY_TOKEN;
  return !!token && bearer(req) === token;
}

export async function POST(req: Request) {
  let byId: string | undefined;
  let byName: string | undefined = "Turia extension";
  if (!relayAuthorized(req)) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    byId = session.user.id;
    byName = session.user.name ?? undefined;
  }

  const parsed = z.object({ cookie: z.string().min(10) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A cookie string is required" }, { status: 400 });

  await storeTuriaCookie(parsed.data.cookie, byId, byName);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  return NextResponse.json(await turiaStatus());
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { storeTuriaCookie, turiaStatus } from "@/lib/neo-centra/turia";

// Store / inspect the firm's Turia session cookie (captured from a logged-in Turia
// tab and relayed here). Directors only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const parsed = z.object({ cookie: z.string().min(10) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A cookie string is required" }, { status: 400 });

  await storeTuriaCookie(parsed.data.cookie, session.user.id, session.user.name ?? undefined);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  return NextResponse.json(await turiaStatus());
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pairingDb } from "@/lib/companion/defaults";
import { createPairingBodyZ, pairingErrorResponse, parseOr400, sessionGuard } from "@/lib/companion/pairing-http";
import { createPairing } from "@/lib/companion/tokens";

export const dynamic = "force-dynamic";

// /companion "Create pairing token": a new token for the signed-in person. The token is in this
// response only; the database keeps its sha256.
export async function POST(req: Request) {
  const g = sessionGuard(await auth());
  if (!g.ok) return g.res;
  const body = parseOr400(createPairingBodyZ, await req.json().catch(() => null));
  if (!body.ok) return body.res;
  try {
    const { token, pairing } = await createPairing(pairingDb(), g.user, body.data.label, new Date());
    return NextResponse.json({ token, pairing }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return pairingErrorResponse(e);
  }
}

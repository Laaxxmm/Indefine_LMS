import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pairingDb } from "@/lib/companion/defaults";
import { pairingErrorResponse, pairingIdZ, parseOr400, sessionGuard } from "@/lib/companion/pairing-http";
import { revokePairing } from "@/lib/companion/tokens";

export const dynamic = "force-dynamic";

// /companion "Revoke": sets revokedAt on one of the signed-in person's own pairings (the row is
// kept). The browser using it is refused on its next refresh.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = sessionGuard(await auth());
  if (!g.ok) return g.res;
  const id = parseOr400(pairingIdZ, (await params).id);
  if (!id.ok) return id.res;
  try {
    return NextResponse.json(await revokePairing(pairingDb(), g.user, id.data, new Date()));
  } catch (e) {
    return pairingErrorResponse(e);
  }
}

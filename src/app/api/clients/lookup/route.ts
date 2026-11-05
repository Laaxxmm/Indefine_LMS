import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canViewClients } from "@/lib/clients/core";
import { findByIdentifier } from "@/lib/search/identifiers";
import { isSensitiveQuery } from "@/lib/search/query";
import { IDENTIFIER_LABELS } from "@/lib/search/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const bodyZ = z.object({ q: z.string().max(100, "Searches can be up to 100 characters. Shorten the search and try again.") });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });

// /clients search by a full PAN, GSTIN, mobile number or email (DPDP, ADR-006 class A). Sent in
// the request body, never in the page address. Exact match only, through the shared identifier
// lookup (src/lib/search/identifiers.ts): results masked, rate limited per person, and every
// lookup audited (purpose "clients-search"). Part of an identifier is refused with a sentence.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return fail(401, "Sign in to search clients.");
  if (!canViewClients(session.user)) return fail(403, "Your account is not active, so client search is not available. Ask an admin to reactivate it.");
  const parsed = bodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "The search could not be read. Reload the page and try again.");
  const q = parsed.data.q;
  if (!isSensitiveQuery(q)) return fail(400, "Search by name or client code with the Filter button.");
  const r = await findByIdentifier(session.user, q, { purpose: "clients-search", types: ["client"] });
  if (!r.ok) {
    if (r.reason === "rate-limited") return fail(429, r.message, r.retryAfterSeconds ? { "Retry-After": String(r.retryAfterSeconds) } : {});
    return fail(400, `${r.message} Part of a PAN, GSTIN, phone number or email is not searched.`);
  }
  return NextResponse.json(
    { matched: `${IDENTIFIER_LABELS[r.kind]} ${r.masked}`, hits: r.hits.map((h) => ({ id: h.id, label: h.label, context: h.context, href: h.href })) },
    { headers: NO_STORE },
  );
}

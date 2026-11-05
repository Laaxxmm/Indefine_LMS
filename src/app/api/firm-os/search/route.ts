import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { INACTIVE_MESSAGE, SIGNED_OUT_MESSAGE, canSearch } from "@/lib/search/access";
import { defaultSearchDeps } from "@/lib/search/defaults";
import { isSensitiveQuery } from "@/lib/search/query";
import { SEARCH_MESSAGES, searchRequestZ } from "@/lib/search/schema";
import { search, type SearchOutcome } from "@/lib/search/service";

// Firm OS search: auth → zod → search() → JSON. GET ?q=&type= for text; POST { q, type } for a PAN,
// GSTIN, phone or email, which GET refuses so identifiers stay out of URLs and access logs.
// Responses are never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string, extra: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });

async function guard() {
  const session = await auth();
  if (!session?.user) return { res: fail(401, SIGNED_OUT_MESSAGE) };
  if (!canSearch(session.user)) return { res: fail(403, INACTIVE_MESSAGE) };
  return { user: session.user };
}

async function run(user: NonNullable<Awaited<ReturnType<typeof guard>>["user"]>, input: unknown, viaUrl: boolean) {
  const parsed = searchRequestZ.safeParse(input);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? SEARCH_MESSAGES.badType);
  if (viaUrl && isSensitiveQuery(parsed.data.q)) return fail(400, SEARCH_MESSAGES.identifierInUrl);
  let r: SearchOutcome;
  try {
    r = await search(user, { q: parsed.data.q, type: parsed.data.type ?? null }, defaultSearchDeps());
  } catch (e) {
    // Log the kind of failure only: a database error message can quote the query (an identifier).
    console.error("firm-os search failed:", (e as { code?: string }).code ?? (e as Error).name);
    return fail(500, SEARCH_MESSAGES.unavailable);
  }
  if (r.ok) return NextResponse.json(r.data, { headers: NO_STORE });
  return fail(r.status, r.error, r.retryAfterSeconds ? { "Retry-After": String(r.retryAfterSeconds) } : {});
}

export async function GET(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  const url = new URL(req.url);
  return run(g.user, { q: url.searchParams.get("q") ?? "", type: url.searchParams.get("type") || undefined }, true);
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.res) return g.res;
  return run(g.user, await req.json().catch(() => null), false);
}

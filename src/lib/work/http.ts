import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import type { Result } from "./core";

/** Outsiders get 404, not 403: the module should not be visible to the rest of the firm. */
export const notFoundJson = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function parseBody<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 }) };
}

export function fromResult<T>(r: Result<T>, status = 200): NextResponse {
  return r.ok ? NextResponse.json(r.data, { status }) : NextResponse.json({ error: r.error }, { status: 400 });
}

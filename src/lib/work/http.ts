import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import type { Result } from "./core";
import { validationMessage } from "@/lib/errors";

/** Outsiders get 404, not 403: the module should not be visible to the rest of the firm. */
export const notFoundJson = () => NextResponse.json({ error: "That item wasn't found. Reload the page and try again." }, { status: 404 });

export async function parseBody<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 }) };
}

export function fromResult<T>(r: Result<T>, status = 200): NextResponse {
  return r.ok ? NextResponse.json(r.data, { status }) : NextResponse.json({ error: r.error }, { status: 400 });
}

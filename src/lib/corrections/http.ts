// Route-handler plumbing for /api/firm-os/corrections/** and /api/firm-os/privacy/**:
// auth → zod → one lib call → JSON (docs/ARCHITECTURE.md §10). Every error body is { error } with
// a plain sentence; the service decides access, so routes only check that someone is signed in.
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { ServiceResult } from "./result";

export type Signed = { ok: true; user: Session["user"] } | { ok: false; res: NextResponse };

export async function signedIn(): Promise<Signed> {
  const session = await auth();
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  return { ok: true, user: session.user };
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): { ok: true; data: z.output<S> } | { ok: false; res: NextResponse } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const msg = parsed.error.issues[0]?.message;
  const sentence = msg && /^[A-Z].*[.]$/.test(msg) ? msg : "Some details in the request are missing or in the wrong format. Reload the page and try again.";
  return { ok: false, res: NextResponse.json({ error: sentence }, { status: 400 }) };
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export function toJson<T>(r: ServiceResult<T>, okStatus = 200): NextResponse {
  return r.ok ? NextResponse.json(r.data, { status: okStatus }) : NextResponse.json({ error: r.error }, { status: r.status });
}

export const idZ = z.string().trim().min(1, "Open the record again from its page; the link to it is incomplete.").max(64).regex(/^[A-Za-z0-9_-]+$/, "Open the record again from its page; the link to it is not valid.");

export const correctionBodyZ = z.object({
  entity: z.string().trim().min(1, "Choose what kind of record to correct.").max(40),
  id: idZ,
  field: z.string().trim().min(1, "Choose the field to correct.").max(60),
  newValue: z.union([z.string().max(5000, "The new value is too long. Shorten it and try again."), z.number(), z.null()]),
  reason: z
    .string()
    .max(500, "Keep the reason to 500 characters or fewer.")
    .optional()
    .transform((v) => v ?? ""),
});

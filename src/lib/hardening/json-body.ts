// A capped JSON body reader for route handlers (re-audit NEW-6). req.json() reads the whole body,
// however large, before parsing: a signed-in caller (or a forged session cookie) sending a chunked
// body with no Content-Length was unbounded, and zod then parsed whatever arrived (npm audit:
// zod < 4.6.6 memory exhaustion on huge inputs). readJsonCapped() counts the bytes as they arrive and
// stops at the cap (1 MB by default): 413 with a plain sentence, nothing parsed. src/middleware.ts
// refuses a declared Content-Length over the tier and (re-audit NEW-6) a body with no length on
// routes that take no uploads, so this is the second line, not the only one.
//
//   readJsonCapped(req, max?)  { ok: true, value } (null for an empty / malformed body, as
//                              req.json().catch(() => null) gave) or { ok: false, res: 413 }
//   readJsonOrMarker(req)      the value, or BODY_TOO_LARGE — for helpers whose callers pass the
//                              result straight to their schema check (parse() maps it to the 413)
import { NextResponse } from "next/server";

export const JSON_BODY_MAX_BYTES = 1024 * 1024;

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${Math.round((n / (1024 * 1024)) * 10) / 10} MB` : `${Math.round(n / 1024)} KB`);

/** The 413 a capped reader answers with. */
export function bodyTooLargeResponse(maxBytes: number = JSON_BODY_MAX_BYTES): NextResponse {
  return NextResponse.json(
    { error: `This request is too large to send. The limit here is ${sizeText(maxBytes)}, so shorten the text or send fewer items at a time.` },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  );
}

/** Stands for "the body was over the cap" where a helper returns the body itself. */
export const BODY_TOO_LARGE: { readonly bodyTooLarge: true } = Object.freeze({ bodyTooLarge: true as const });

/** The JSON body, read with a running byte count that stops at `maxBytes` (see the header). */
export async function readJsonCapped(req: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; res: NextResponse }> {
  const declared = req.headers.get("content-length")?.trim();
  if (declared && /^\d{1,15}$/.test(declared) && Number(declared) > maxBytes) return { ok: false, res: bodyTooLargeResponse(maxBytes) };
  if (!req.body) return { ok: true, value: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, res: bodyTooLargeResponse(maxBytes) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: true, value: null };
  }
  const bytes = new Uint8Array(seen);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: true, value: null };
  }
}

/** The JSON body (null when empty or malformed), or BODY_TOO_LARGE over the cap. */
export async function readJsonOrMarker(req: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<unknown> {
  const r = await readJsonCapped(req, maxBytes);
  return r.ok ? r.value : BODY_TOO_LARGE;
}

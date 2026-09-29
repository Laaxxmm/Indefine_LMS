// Receives posts from the statutory-extension, which collects the six portals that
// refuse non-Indian IPs from an office PC. Auth: Authorization: Bearer $STATUTORY_RELAY_TOKEN.
// The extension sends a portal's items in small chunks (PDFs travel as base64 and are
// read here), and marks the last chunk with `done` to record the portal's status line.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bearerUnauthorized } from "@/lib/cron-auth";
import { pdfTextFromBytes } from "@/lib/statutory/cloud";
import { saveItems, saveStatus, summarisePending } from "@/lib/statutory/digest";
import { EXTENSION_PORTALS, type RawItem } from "@/lib/statutory/portals";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const itemZ = z.object({
  section: z.string().nullable().optional(),
  doc_type: z.string().optional(),
  title: z.string().min(1).max(1000),
  issue_date: day,
  upload_date: day,
  date_basis: z.string().optional(),
  url: z.string().regex(/^https?:\/\//).max(2000).nullable().optional(),
  alt_url: z.string().regex(/^https?:\/\//).max(2000).nullable().optional(),
  text: z.string().nullable().optional(), // page text (HTML documents)
  pdfBase64: z.string().nullable().optional(), // PDF documents
});
const bodyZ = z.object({
  portal: z.enum(EXTENSION_PORTALS as [string, ...string[]]),
  items: z.array(itemZ).max(50),
  done: z.object({ ok: z.boolean(), error: z.string().nullable().optional(), fetched: z.number().int(), inRange: z.number().int() }).optional(),
});

export async function POST(req: NextRequest) {
  const denied = bearerUnauthorized(req, process.env.STATUTORY_RELAY_TOKEN);
  if (denied) return denied;
  const parsed = bodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad body" }, { status: 400 });
  const { portal, items, done } = parsed.data;

  const rows: RawItem[] = [];
  for (const x of items) {
    let text = x.text ? x.text.replace(/\s+/g, " ").trim().slice(0, 1800) : null;
    if (x.pdfBase64) {
      const buf = Buffer.from(x.pdfBase64, "base64");
      text = buf.length > MAX_PDF_BYTES ? "[PDF too large to read]" : await pdfTextFromBytes(buf);
    }
    rows.push({
      portal, section: x.section ?? null, doc_type: x.doc_type ?? "Other", title: x.title.replace(/\s+/g, " ").trim(),
      issue_date: x.issue_date ?? null, upload_date: x.upload_date ?? null, date_basis: x.date_basis ?? "upload",
      url: x.url ?? null, alt_url: x.alt_url ?? null, text,
    });
  }
  await saveItems(rows);
  if (done) await saveStatus({ portal, ok: done.ok, error: done.error ?? null, fetched: done.fetched, inRange: done.inRange }, "extension");
  if (done) void summarisePending().catch((e) => console.error("[statutory] summarise failed", e));
  return NextResponse.json({ ok: true, saved: rows.length });
}

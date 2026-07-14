import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { byId, isEnabled } from "@/lib/certificates/registry";
import { renderDocx } from "@/lib/certificates/render/toDocx";
import { CertificateValidationError } from "@/lib/certificates/render/values";
import { PlaceholderLeakError } from "@/lib/certificates/render/compose";
import { DOCX_MIME, certificateFilename } from "@/lib/certificates/download";
import { SUGGESTIBLE_FIELD_KEYS } from "@/lib/certificates/suggestible";

const Body = z.object({
  formatId: z.string(),
  clientName: z.string().min(1),
  acknowledged: z.boolean(),
  payload: z.record(z.unknown()),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { formatId, clientName, acknowledged, payload } = parsed.data;

  // §0.8 — the illustrative-format acknowledgment must be ticked.
  if (acknowledged !== true) return NextResponse.json({ error: "Acknowledgment is required" }, { status: 400 });

  const template = byId(formatId);
  if (!template || (process.env.NODE_ENV === "production" && !isEnabled(template))) {
    return NextResponse.json({ error: "Unknown or unavailable format" }, { status: 400 });
  }

  // Render from the server's own pinned template + the submitted values (§0.3). This also
  // validates: a missing field or residual placeholder throws, and no row is written.
  let buffer: Buffer;
  try {
    buffer = await renderDocx(template, payload as Record<string, unknown>);
  } catch (e) {
    if (e instanceof CertificateValidationError) return NextResponse.json({ error: "Some fields are missing or invalid", fieldErrors: e.fieldErrors }, { status: 400 });
    if (e instanceof PlaceholderLeakError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // No rendered file is stored — only the reproducible record (§0.6).
  const issue = await prisma.certificateIssue.create({
    data: {
      formatId: template.id,
      formatTitle: template.title,
      templateVersion: template.version,
      templateHash: template.hash,
      clientName,
      payload: payload as object,
      acknowledged,
      createdById: session.user.id,
    },
    select: { id: true },
  });

  // Remember the reusable signing values firm-wide (best-effort) — feeds the field dropdowns.
  const remember = SUGGESTIBLE_FIELD_KEYS
    .map((k) => ({ fieldKey: k as string, value: String((payload as Record<string, unknown>)[k] ?? "").trim(), createdById: session.user.id }))
    .filter((o) => o.value.length > 0 && o.value.length <= 200);
  if (remember.length) await prisma.certificateFieldOption.createMany({ data: remember, skipDuplicates: true }).catch(() => {});

  const filename = certificateFilename(formatId, clientName, new Date().toISOString());
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Issue-Id": issue.id,
      "X-Filename": filename,
      "Cache-Control": "no-store",
    },
  });
}

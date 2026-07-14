import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { SUGGESTIBLE_FIELD_KEYS, isSuggestible } from "@/lib/certificates/suggestible";

// Firm-wide saved values for reusable signing fields. Shared across all internal users.

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.certificateFieldOption.findMany({
    where: { fieldKey: { in: [...SUGGESTIBLE_FIELD_KEYS] } },
    orderBy: { value: "asc" },
    select: { id: true, fieldKey: true, value: true },
  });

  const options: Record<string, { id: string; value: string }[]> = {};
  for (const key of SUGGESTIBLE_FIELD_KEYS) options[key] = [];
  for (const r of rows) (options[r.fieldKey] ??= []).push({ id: r.id, value: r.value });
  return NextResponse.json({ options });
}

const Body = z.object({ fieldKey: z.string(), value: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { fieldKey, value } = parsed.data;
  if (!isSuggestible(fieldKey)) return NextResponse.json({ error: "Field is not saveable" }, { status: 400 });

  // Idempotent on the [fieldKey, value] unique constraint.
  const row = await prisma.certificateFieldOption.upsert({
    where: { fieldKey_value: { fieldKey, value } },
    update: {},
    create: { fieldKey, value, createdById: session.user.id },
    select: { id: true, fieldKey: true, value: true },
  });
  return NextResponse.json({ option: row }, { status: 201 });
}

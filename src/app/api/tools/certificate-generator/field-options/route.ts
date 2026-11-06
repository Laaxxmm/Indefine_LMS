import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { SUGGESTIBLE_FIELD_KEYS, isSuggestible } from "@/lib/certificates/suggestible";
import { readJsonCapped } from "@/lib/hardening/json-body";

// Firm-wide saved values for reusable signing fields. Shared across all internal users.

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "You don't have access to the certificate generator. Ask an admin to give you access." }, { status: 403 });

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
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "You don't have access to the certificate generator. Ask an admin to give you access." }, { status: 403 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = Body.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: "Some details were missing or not in the right format. Check the form and try again." }, { status: 400 });
  const { fieldKey, value } = parsed.data;
  if (!isSuggestible(fieldKey)) return NextResponse.json({ error: "Suggestions can't be saved for this field." }, { status: 400 });

  // Idempotent on the [fieldKey, value] unique constraint.
  const row = await prisma.certificateFieldOption.upsert({
    where: { fieldKey_value: { fieldKey, value } },
    update: {},
    create: { fieldKey, value, createdById: session.user.id },
    select: { id: true, fieldKey: true, value: true },
  });
  return NextResponse.json({ option: row }, { status: 201 });
}

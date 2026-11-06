import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { canRevealClientPii } from "@/lib/rbac/policy";
import { EDIT_PRIVATE_FIELDS, PII_FIELDS, PII_LABELS, type PiiField } from "@/lib/clients/pii";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const bodyZ = z.object({ field: z.enum(PII_FIELDS, { errorMap: () => ({ message: "Choose which detail to show." }) }) });
const COLUMN: Record<PiiField, "pan" | "gstin" | "contactPhone" | "contactEmail"> = { pan: "pan", gstin: "gstin", phone: "contactPhone", email: "contactEmail" };

// "Show" on /clients/[id]: one full identifier of one client, for management only (whoever may
// edit the client: canRevealClientPii = canManageClients). Everyone else sees it masked. Every
// reveal writes an AuditEvent ("viewed PAN of client X"); the value itself is never stored there.
//
// { purpose: "edit" }: the edit form, when it is opened, loads the full values of the client's
// personal fields (EDIT_PRIVATE_FIELDS) here instead of receiving them with every page load. One
// AuditEvent per opening, naming the fields, never their values.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: NO_STORE });
  if (!canRevealClientPii(session.user)) {
    return NextResponse.json({ error: "Only admins and partners can see a client's full PAN, GSTIN, phone or email. Use the masked value, or ask one of them." }, { status: 403, headers: NO_STORE });
  }
  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const body = (jsonBody.value) as unknown;
  const { id } = await params;
  if ((body as { purpose?: unknown } | null)?.purpose === "edit") return editValues(session.user.id, id);
  const parsed = bodyZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error, "Choose which detail to show.") }, { status: 400, headers: NO_STORE });
  const field = parsed.data.field;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true, pan: true, gstin: true, contactPhone: true, contactEmail: true } });
  if (!client) return NextResponse.json({ error: "That client wasn't found. Go back to the client list and open it again." }, { status: 404, headers: NO_STORE });
  const value = client[COLUMN[field]];
  await logAudit(prisma, {
    actorId: session.user.id,
    action: "client-pii-view",
    entity: "Client",
    entityId: client.id,
    meta: { field, summary: `viewed ${PII_LABELS[field]} of client ${client.id}`, present: !!value },
  });
  return NextResponse.json({ field, value: value ?? null }, { headers: NO_STORE });
}

async function editValues(actorId: string, id: string): Promise<NextResponse> {
  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, pan: true, gstin: true, contactPhone: true, contactEmail: true, contactName: true, referralSource: true, growthNote: true },
  });
  if (!client) return NextResponse.json({ error: "That client wasn't found. Go back to the client list and open it again." }, { status: 404, headers: NO_STORE });
  const values = Object.fromEntries(EDIT_PRIVATE_FIELDS.map((f) => [f, client[f] ?? ""]));
  await logAudit(prisma, {
    actorId,
    action: "client-pii-view",
    entity: "Client",
    entityId: client.id,
    meta: { purpose: "edit", fields: [...EDIT_PRIVATE_FIELDS], summary: `opened the edit form of client ${client.id}` },
  });
  return NextResponse.json({ values }, { headers: NO_STORE });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { downloadDriveItem, getAppOnlyToken, getUserGraphToken, sendMailAsUser } from "@/lib/graph";
import { MAIL_SCOPES } from "@/lib/graph-scopes";
import { fileName, isEmail } from "@/lib/office-tools/engagement-letters";

export const maxDuration = 60;

const list = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean);

// Email the uploaded signed PDF to the client from the sender's own mailbox.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const { id } = await params;
  const letter = await prisma.engagementLetter.findUnique({ where: { id } });
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  if (!letter.signedItemId || !letter.graphDriveId) {
    return NextResponse.json({ error: "Upload the signed PDF before sending" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { to?: unknown; cc?: unknown; subject?: string; text?: string } | null;
  const to = list(body?.to);
  const cc = list(body?.cc);
  const bad = [...to, ...cc].find((e) => !isEmail(e));
  if (!to.length) return NextResponse.json({ error: "Add at least one recipient" }, { status: 400 });
  if (bad) return NextResponse.json({ error: `Not an email address: ${bad}` }, { status: 400 });
  if (!body?.subject?.trim() || !body?.text?.trim()) return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });

  const mailToken = await getUserGraphToken(session.user.id, MAIL_SCOPES);
  if (!mailToken) {
    return NextResponse.json(
      { error: "Connect your Microsoft 365 mailbox first, then send again", connect: "/connect?mail=1" },
      { status: 412 }
    );
  }
  const appToken = await getAppOnlyToken();
  if (!appToken) return NextResponse.json({ error: "SharePoint is not configured" }, { status: 502 });

  try {
    const bytes = await downloadDriveItem(letter.graphDriveId, letter.signedItemId, appToken);
    await sendMailAsUser(mailToken, {
      to,
      cc,
      subject: body.subject.trim(),
      text: body.text,
      attachments: [{ name: fileName(letter.clientName, letter.fy, "signed"), contentType: "application/pdf", bytes }],
    });
  } catch (e) {
    console.error("EL send failed:", (e as Error).message);
    return NextResponse.json({ error: "Sending failed — check the addresses and try again" }, { status: 502 });
  }

  const byName = session.user.name ?? "Unknown";
  const sentTo = [...to, ...cc].join(", ");
  await prisma.engagementLetter.update({
    where: { id },
    data: { sentAt: new Date(), sentTo, updatedByName: byName, ...(letter.status === "CLIENT_SIGNED" ? {} : { status: "SENT" }) },
  });
  await prisma.engagementLetterEvent.create({ data: { letterId: id, action: "sent", detail: `To ${sentTo}`, byId: session.user.id, byName } });
  return NextResponse.json({ ok: true });
}

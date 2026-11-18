import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { downloadDriveItem, getAppOnlyToken, getUserGraphToken } from "@/lib/graph";
import { MAIL_SCOPES } from "@/lib/graph-scopes";
import { createOutlookDraft } from "@/lib/integrations/outlook/drafts";
import { fileName, isEmail } from "@/lib/office-tools/engagement-letters";
import { WAITING, can } from "@/lib/office-tools/engagement-letter-flow";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const maxDuration = 60;

const list = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean);

// "Create Outlook draft" for the unsigned draft (kind=draft, for approval) or the signed letter
// (kind=signed): a draft message in the staff member's OWN mailbox (Drafts folder) with the same
// recipients, subject, text and the letter PDF attached. The app never sends it (owner decision,
// 2026-11-05; Firm OS non-negotiable 1): the person opens the draft in Outlook, checks it and
// sends it. The letter moves to the closest existing stage — SENT_FOR_APPROVAL for the draft,
// SENT for the signed letter — as the hand-off to email; the history row says an Outlook draft
// was created.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool. Ask an admin to give you access." }, { status: 403 });

  const { id } = await params;
  const letter = await prisma.engagementLetter.findUnique({ where: { id } });
  if (!letter) return NextResponse.json({ error: "That letter wasn't found. Go back to the letters list and open it again." }, { status: 404 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const body = (jsonBody.value) as { kind?: string; to?: unknown; cc?: unknown; subject?: string; text?: string } | null;
  const kind = body?.kind === "draft" ? "draft" : "signed";
  const step = kind === "draft" ? "sendDraft" : "sendSigned";
  const itemId = kind === "draft" ? letter.draftItemId : letter.signedItemId;
  if (!can(step, letter.status) || !itemId || !letter.graphDriveId) return NextResponse.json({ error: WAITING[step] }, { status: 409 });

  const to = list(body?.to);
  const cc = list(body?.cc);
  const bad = [...to, ...cc].find((e) => !isEmail(e));
  if (!to.length) return NextResponse.json({ error: "Add at least one recipient." }, { status: 400 });
  if (bad) return NextResponse.json({ error: `${bad} is not an email address. Check it and try again.` }, { status: 400 });
  if (!body?.subject?.trim() || !body?.text?.trim()) return NextResponse.json({ error: "Enter a subject and a message." }, { status: 400 });

  const mailToken = await getUserGraphToken(session.user.id, MAIL_SCOPES);
  if (!mailToken) {
    return NextResponse.json(
      { error: "Connect your Microsoft 365 mailbox first, then create the draft again.", connect: "/connect?mail=1" },
      { status: 412 }
    );
  }
  const appToken = await getAppOnlyToken();
  if (!appToken) return NextResponse.json({ error: "The connection to SharePoint is not set up on the server. Ask IT to finish the Microsoft 365 setup." }, { status: 502 });

  let webLink: string | null;
  try {
    const bytes = await downloadDriveItem(letter.graphDriveId, itemId, appToken);
    const draft = await createOutlookDraft(mailToken, {
      to,
      cc,
      subject: body.subject.trim(),
      body: body.text,
      bodyType: "Text",
      attachments: [{ name: fileName(letter.clientName, letter.fy, kind), contentType: "application/pdf", bytes }],
    });
    webLink = draft.webLink;
  } catch (e) {
    console.error("EL Outlook draft failed:", (e as Error).message);
    return NextResponse.json({ error: "Outlook could not create the draft. Check the email addresses and try again." }, { status: 502 });
  }

  const byName = session.user.name ?? "Unknown";
  const recipients = [...to, ...cc].join(", ");
  await prisma.engagementLetter.update({
    where: { id },
    data:
      kind === "draft"
        ? { draftSentAt: new Date(), status: "SENT_FOR_APPROVAL", updatedByName: byName }
        : { sentAt: new Date(), sentTo: recipients, status: "SENT", updatedByName: byName },
  });
  await prisma.engagementLetterEvent.create({
    data: {
      letterId: id,
      action: kind === "draft" ? "draft-outlook-draft" : "signed-outlook-draft",
      detail: `Outlook draft for ${recipients}, to be sent by ${byName} from Outlook`,
      byId: session.user.id,
      byName,
    },
  });
  return NextResponse.json({ ok: true, webLink });
}

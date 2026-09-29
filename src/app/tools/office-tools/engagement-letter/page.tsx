import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, FileSignature, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { defaultRecipients, elRoot, emailTemplate, fyLabel, type LetterData } from "@/lib/office-tools/engagement-letters";
import { LetterActions } from "./LetterActions";

export const dynamic = "force-dynamic";

const EDITOR = "/tools/office-tools/engagement-letter/editor";

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-muted text-ink-mute" },
  SIGNED: { label: "Signed, not sent", cls: "bg-amber-50 text-amber-700" },
  SENT: { label: "Sent to client", cls: "bg-brand-50 text-brand-700" },
  CLIENT_SIGNED: { label: "Client signed", cls: "bg-emerald-50 text-emerald-700" },
};

const ACTION: Record<string, string> = {
  saved: "Saved",
  "signed-upload": "Signed PDF uploaded",
  sent: "Emailed",
  "client-signed-upload": "Client-signed copy uploaded",
};

const fmt = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Register of engagement letters: one row per client per FY, with every version.
export default async function EngagementLetterRegister() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseOfficeTools(session.user)) redirect("/dashboard");

  const letters = await prisma.engagementLetter.findMany({
    orderBy: [{ clientName: "asc" }, { fy: "desc" }],
    include: { events: { orderBy: { at: "asc" }, select: { id: true, action: true, detail: true, byName: true, at: true } } },
  });

  return (
    <div>
      <Link href="/tools/office-tools" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All office tools
      </Link>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mb-1">Engagement letters</h1>
          <p className="text-ink-mute text-[14px] max-w-2xl">
            Create a letter, save it here, sign the PDF (DSC in Acrobat or by hand), upload it and email it to the client. Files are
            stored in SharePoint under <b>{elRoot()}/&lt;client&gt;</b>; re-uploading replaces the file and SharePoint keeps the
            earlier versions.
          </p>
        </div>
        <a href={EDITOR} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition shrink-0">
          <FilePlus2 className="w-4 h-4" /> New letter
        </a>
      </div>

      {letters.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <FileSignature className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No letters yet</p>
          <p className="text-ink-mute text-sm mt-0.5">Letters appear here once you click Save to register in the generator.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {letters.map((l) => {
            const data = l.data as LetterData;
            const saves = l.events.filter((e) => e.action === "saved");
            const st = STATUS[l.status];
            const mail = emailTemplate(data, l.fy, session.user.name ?? "");
            return (
              <div key={l.id} className="rounded-2xl bg-card border border-border shadow-lift p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-display font-bold text-lg leading-tight">{l.clientName}</div>
                    <div className="text-[13px] text-ink-mute mt-0.5">
                      FY {fyLabel(l.fy)} · v{saves.length} · updated {fmt(l.updatedAt)} by {l.updatedByName}
                      {l.sentAt && <> · emailed {fmt(l.sentAt)}</>}
                    </div>
                  </div>
                  <span className={`text-[11px] font-extrabold tracking-wide uppercase px-2 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <a href={`${EDITOR}?id=${l.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm font-semibold hover:bg-muted transition">
                    <Pencil className="w-3.5 h-3.5" /> Edit / regenerate
                  </a>
                  {l.signedWebUrl && (
                    <a href={l.signedWebUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full border border-border text-sm font-semibold hover:bg-muted transition">
                      Signed PDF
                    </a>
                  )}
                  {l.clientSignedWebUrl && (
                    <a href={l.clientSignedWebUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full border border-border text-sm font-semibold hover:bg-muted transition">
                      Client-signed PDF
                    </a>
                  )}
                  <LetterActions
                    id={l.id}
                    hasSigned={!!l.signedItemId}
                    mail={{ to: defaultRecipients(data).join(", "), cc: "", subject: mail.subject, text: mail.text }}
                  />
                </div>

                <details className="mt-3 text-[13px]">
                  <summary className="cursor-pointer font-semibold text-ink-mute">History ({l.events.length})</summary>
                  <ol className="mt-2 space-y-1">
                    {l.events.map((e) => {
                      const v = e.action === "saved" ? saves.findIndex((s) => s.id === e.id) + 1 : 0;
                      return (
                        <li key={e.id} className="flex flex-wrap gap-x-2 text-ink-mute">
                          <span className="text-ink-faint">{fmt(e.at)}</span>
                          <span className="font-semibold text-ink">{ACTION[e.action] ?? e.action}{v ? ` v${v}` : ""}</span>
                          <span>by {e.byName}</span>
                          {e.detail && <span>· {e.detail}</span>}
                          {v > 0 && v < saves.length && (
                            <a href={`${EDITOR}?id=${l.id}&v=${e.id}`} className="font-semibold text-brand-600 hover:underline">open v{v}</a>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

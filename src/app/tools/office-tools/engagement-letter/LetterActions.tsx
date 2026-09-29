"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EngagementLetterStatus } from "@prisma/client";
import { Check, Mail, Upload } from "lucide-react";
import { can, type Step } from "@/lib/office-tools/engagement-letter-flow";

type Draft = { to: string; cc: string; subject: string; text: string };
type Kind = "draft" | "signed" | "client";

const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm font-semibold hover:bg-muted transition disabled:opacity-50";
const primary = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition disabled:opacity-50";
const input = "w-full px-3 py-2 rounded-lg border border-border bg-card text-sm";

// Progress along the approval flow; index = how many steps are done.
const STEPS = ["Draft PDF", "Sent for approval", "Approved", "Signed", "Signed letter sent", "Client signed"];
const DONE: Record<EngagementLetterStatus, number> = {
  DRAFT: 0, DRAFT_UPLOADED: 1, SENT_FOR_APPROVAL: 2, APPROVED: 3, SIGNED: 4, SENT: 5, CLIENT_SIGNED: 6,
};

// Only the actions the letter's current stage allows are shown; the next step is highlighted.
export function LetterActions({ id, status, mails }: { id: string; status: EngagementLetterStatus; mails: Record<"draft" | "signed", Draft> }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>("draft");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; link?: string } | null>(null);
  const [draft, setDraft] = useState<(Draft & { kind: "draft" | "signed" }) | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(url: string, init: RequestInit, ok: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, init).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok) {
      setMsg({ text: ok });
      setDraft(null);
      setNote(null);
      router.refresh();
    } else {
      setMsg({ text: j?.error ?? "Something went wrong", link: j?.connect });
    }
  }

  function pick(k: Kind) {
    setKind(k);
    fileRef.current?.click();
  }
  function upload(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    call(`/api/tools/engagement-letters/${id}/file`, { method: "POST", body: fd }, "Uploaded to SharePoint.");
  }
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const show = (s: Step) => can(s, status);
  const done = DONE[status];

  return (
    <div className="basis-full space-y-2">
      <ol className="flex flex-wrap gap-x-1 gap-y-1 text-[11.5px] font-semibold">
        {STEPS.map((s, i) => (
          <li key={s} className={`px-2 py-0.5 rounded-full ${i < done ? "bg-emerald-50 text-emerald-700" : i === done ? "bg-brand-50 text-brand-700" : "bg-muted text-ink-faint"}`}>
            {i < done && <Check className="inline w-3 h-3 -mt-0.5 mr-0.5" />}{i + 1}. {s}
          </li>
        ))}
      </ol>

      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        {show("uploadDraft") && (
          <button type="button" className={status === "DRAFT" ? primary : btn} disabled={busy} onClick={() => pick("draft")}>
            <Upload className="w-3.5 h-3.5" /> {status === "DRAFT" ? "Upload draft PDF (unsigned)" : "Replace draft PDF"}
          </button>
        )}
        {show("sendDraft") && (
          <button type="button" className={status === "DRAFT_UPLOADED" ? primary : btn} disabled={busy} onClick={() => setDraft({ ...mails.draft, kind: "draft" })}>
            <Mail className="w-3.5 h-3.5" /> {status === "SENT_FOR_APPROVAL" ? "Resend draft" : "Email draft for approval"}
          </button>
        )}
        {show("approve") && (
          <button type="button" className={status === "SENT_FOR_APPROVAL" ? primary : btn} disabled={busy} onClick={() => setNote("")}>
            <Check className="w-3.5 h-3.5" /> Mark approved by client
          </button>
        )}
        {show("uploadSigned") && (
          <button type="button" className={status === "APPROVED" ? primary : btn} disabled={busy} onClick={() => pick("signed")}>
            <Upload className="w-3.5 h-3.5" /> {status === "APPROVED" ? "Upload signed PDF" : "Replace signed PDF"}
          </button>
        )}
        {show("sendSigned") && (
          <button type="button" className={status === "SIGNED" ? primary : btn} disabled={busy} onClick={() => setDraft({ ...mails.signed, kind: "signed" })}>
            <Mail className="w-3.5 h-3.5" /> {status === "SENT" ? "Resend signed letter" : "Email signed letter"}
          </button>
        )}
        {show("uploadClient") && (
          <button type="button" className={status === "SENT" ? primary : btn} disabled={busy} onClick={() => pick("client")}>
            <Upload className="w-3.5 h-3.5" /> {status === "CLIENT_SIGNED" ? "Replace client-signed copy" : "Upload client-signed copy"}
          </button>
        )}
        {msg && (
          <span className="text-[13px] text-ink-mute">
            {msg.text}{" "}
            {msg.link && <a href={msg.link} className="font-semibold text-brand-600 hover:underline">Connect mailbox</a>}
          </span>
        )}
      </div>
      {status === "SENT_FOR_APPROVAL" && (
        <p className="text-[12.5px] text-ink-faint">Client asked for changes? Use Edit / regenerate, save, and upload the new draft.</p>
      )}

      {note !== null && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <label className="block text-[12px] font-semibold text-ink-mute">Who approved it, and how?
            <input className={input} autoFocus placeholder="e.g. Ravi Kumar, by email on 30 Sep" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy || !note.trim()} onClick={() => call(`/api/tools/engagement-letters/${id}/approve`, json({ note }), "Marked approved. You can now sign the letter.")}>
              Mark approved
            </button>
            <button type="button" className={btn} onClick={() => setNote(null)}>Cancel</button>
          </div>
        </div>
      )}

      {draft && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <label className="block text-[12px] font-semibold text-ink-mute">To (comma-separated)
            <input className={input} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-mute">Cc
            <input className={input} value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-mute">Subject
            <input className={input} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-mute">Message
            <textarea className={`${input} font-sans`} rows={14} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </label>
          <p className="text-[12px] text-ink-faint">
            The {draft.kind === "draft" ? "unsigned draft" : "signed"} PDF is attached. Sent from your own Microsoft 365 mailbox.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={primary} onClick={() => call(`/api/tools/engagement-letters/${id}/send`, json(draft), "Email sent. A copy is in your Sent Items.")}>
              {busy ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

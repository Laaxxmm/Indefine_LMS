"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Upload } from "lucide-react";

type Draft = { to: string; cc: string; subject: string; text: string };

const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm font-semibold hover:bg-muted transition disabled:opacity-50";
const input = "w-full px-3 py-2 rounded-lg border border-border bg-card text-sm";

// Upload the signed / client-signed PDF, and email the signed PDF with the standard mail.
export function LetterActions({ id, hasSigned, mail }: { id: string; hasSigned: boolean; mail: Draft }) {
  const router = useRouter();
  const signedRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; link?: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function upload(kind: "signed" | "client", file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const res = await fetch(`/api/tools/engagement-letters/${id}/file`, { method: "POST", body: fd }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(false);
    setMsg({ text: res?.ok ? "Uploaded to SharePoint." : j?.error ?? "Upload failed" });
    if (res?.ok) router.refresh();
  }

  async function send() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/tools/engagement-letters/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok) {
      setDraft(null);
      setMsg({ text: "Email sent. A copy is in your Sent Items." });
      router.refresh();
    } else {
      setMsg({ text: j?.error ?? "Sending failed", link: j?.connect });
    }
  }

  return (
    <>
      <input ref={signedRef} type="file" accept="application/pdf" hidden onChange={(e) => { upload("signed", e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={clientRef} type="file" accept="application/pdf" hidden onChange={(e) => { upload("client", e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" className={btn} disabled={busy} onClick={() => signedRef.current?.click()}>
        <Upload className="w-3.5 h-3.5" /> {hasSigned ? "Replace signed PDF" : "Upload signed PDF"}
      </button>
      <button type="button" className={btn} disabled={busy || !hasSigned} title={hasSigned ? "" : "Upload the signed PDF first"} onClick={() => setDraft(draft ? null : mail)}>
        <Mail className="w-3.5 h-3.5" /> Email to client
      </button>
      <button type="button" className={btn} disabled={busy} onClick={() => clientRef.current?.click()}>
        <Upload className="w-3.5 h-3.5" /> Upload client-signed copy
      </button>
      {msg && (
        <span className="text-[13px] text-ink-mute">
          {msg.text}{" "}
          {msg.link && <a href={msg.link} className="font-semibold text-brand-600 hover:underline">Connect mailbox</a>}
        </span>
      )}

      {draft && (
        <div className="basis-full mt-2 rounded-xl border border-border bg-muted/30 p-4 space-y-2">
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
          <p className="text-[12px] text-ink-faint">The signed PDF is attached. Sent from your own Microsoft 365 mailbox.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={send} className="px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition disabled:opacity-50">
              {busy ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

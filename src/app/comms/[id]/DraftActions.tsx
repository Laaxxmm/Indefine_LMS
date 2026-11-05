"use client";

import { useState } from "react";
import { btnGhost, call } from "@/components/ui";

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";
const primary = `px-4 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition disabled:opacity-50 ${focusRing}`;

// "Open in Outlook draft" (primary) puts the message in the Drafts folder of the person's own
// mailbox and opens it; "Copy" puts subject + body on the clipboard. Neither sends anything.
export function DraftActions({ id, subject, body, inOutlook }: { id: string; subject: string; body: string; inOutlook: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; connect?: string; link?: string } | null>(null);

  async function openOutlook() {
    setBusy(true);
    setMsg(null);
    const r = await call(`/api/firm-os/comms/drafts/${id}/outlook`).catch(() => ({ ok: false, error: "Could not reach the server", data: {} as Record<string, unknown> }));
    setBusy(false);
    if (r.ok) {
      const link = typeof r.data.webLink === "string" ? r.data.webLink : undefined;
      if (link) window.open(link, "_blank", "noopener,noreferrer");
      setMsg({ text: "The draft is in the Drafts folder of your Outlook mailbox. Check it there and send it yourself.", link });
    } else {
      setMsg({ text: r.error ?? "Something went wrong", connect: typeof r.data.connect === "string" ? r.data.connect : undefined });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setMsg({ text: "Copied the subject and message." });
    } catch {
      setMsg({ text: "Your browser did not allow copying; select the text and copy it instead." });
    }
  }

  return (
    <div className="sticky bottom-0 mt-6 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 border-t border-border bg-card/95 backdrop-blur flex flex-wrap items-center gap-3">
      <button type="button" className={primary} disabled={busy} onClick={openOutlook}>
        {busy ? "Creating the Outlook draft…" : "Open in Outlook draft"}
      </button>
      <button type="button" className={`${btnGhost} ${focusRing}`} onClick={copy}>
        Copy
      </button>
      <span className="text-[12.5px] text-ink-mute" role="status" aria-live="polite">
        {msg ? (
          <>
            {msg.text}{" "}
            {msg.link && (
              <a href={msg.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">
                Open it again
              </a>
            )}
            {msg.connect && (
              <a href={msg.connect} className="font-semibold text-brand-600 hover:underline">
                Connect mailbox
              </a>
            )}
          </>
        ) : inOutlook ? (
          "An Outlook draft was made from this before; opening finds it again while it is still a draft."
        ) : (
          "Nothing is sent from here."
        )}
      </span>
    </div>
  );
}

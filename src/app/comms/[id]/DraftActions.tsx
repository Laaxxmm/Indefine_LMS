"use client";

import { useState } from "react";
import { call, linkText, pageBleed, pageGutter } from "@/components/ui";
import { Button } from "@/components/firm-os";

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
    // The page's action bar, as on the run review screen: sticky at the bottom, edge to edge.
    <div className={`sticky bottom-0 mt-8 -mb-8 ${pageBleed} ${pageGutter} py-3 border-t border-border bg-card/95 backdrop-blur flex flex-wrap items-center gap-3`}>
      <Button variant="primary" busy={busy} busyLabel="Creating the Outlook draft…" onClick={openOutlook}>
        Open in Outlook draft
      </Button>
      <Button onClick={copy}>Copy</Button>
      <span className="text-[12px] leading-4 text-ink-mute" role="status" aria-live="polite">
        {msg ? (
          <>
            {msg.text}{" "}
            {msg.link && (
              <a href={msg.link} target="_blank" rel="noopener noreferrer" className={linkText}>
                Open it again
              </a>
            )}
            {msg.connect && (
              <a href={msg.connect} className={linkText}>
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

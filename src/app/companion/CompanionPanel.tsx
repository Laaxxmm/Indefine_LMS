"use client";

// /companion client panel: create a pairing token (shown once, with a copy button), list active
// pairings, revoke one (two steps: Revoke, then Confirm revoke with what it does). Every action
// goes through /api/firm-os/companion/* with the shared call() helper; the list is re-read from the
// server (router.refresh) after each change.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { btnGhost, btnSm, call, card, field, formWidth, hintText, labelText, sectionTitle, td } from "@/components/ui";
import { MSG } from "@/lib/companion/messages";
import type { PairingView } from "@/lib/companion/tokens";
import { Alert, Button, ConfirmStep, DataTable, EmptyState, Section } from "@/components/firm-os";

const API = "/api/firm-os/companion/tokens";
const ghost = btnGhost;

function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Alert tone="error" className="mt-4">
      {text}
    </Alert>
  );
}

function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  return (
    <button
      type="button"
      aria-label={`Copy ${what}`}
      className={`${ghost} ${btnSm}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("blocked"); // the value stays visible to select by hand
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      {state === "copied" ? "Copied" : state === "blocked" ? "Copy blocked: select the code" : "Copy"}
    </button>
  );
}

type Created = { token: string; pairing: PairingView };

export function CompanionPanel({ pairings, inactiveCount, maxActive, ttlDays }: { pairings: PairingView[]; inactiveCount: number; maxActive: number; ttlDays: number }) {
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);

  return (
    <div className="space-y-8">
      {created ? (
        <TokenReveal created={created} ttlDays={ttlDays} onDone={() => setCreated(null)} />
      ) : (
        <CreateForm
          atLimit={pairings.length >= maxActive}
          maxActive={maxActive}
          ttlDays={ttlDays}
          onCreated={(c) => {
            setCreated(c);
            router.refresh();
          }}
        />
      )}
      <PairingsTable pairings={pairings} inactiveCount={inactiveCount} onRevoked={() => router.refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------- create

function CreateForm({ atLimit, maxActive, ttlDays, onCreated }: { atLimit: boolean; maxActive: number; ttlDays: number; onCreated: (c: Created) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={`${card} ${formWidth}`}
      aria-labelledby="pair-title"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          const r = await call(API, { label: name.trim() });
          if (!r.ok) setError(r.error);
          else {
            setName("");
            onCreated({ token: String(r.data.token), pairing: r.data.pairing as PairingView });
          }
        } catch {
          setError(MSG.unreachable);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="pair-title" className={sectionTitle}>
        Pair a browser
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="companion-label" className={labelText}>
          Name for this pairing
        </label>
        <input
          id="companion-label"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="e.g. Office desktop, Chrome"
          aria-describedby="companion-label-help"
          className={field}
        />
        <span id="companion-label-help" className={hintText}>
          So you can tell your pairings apart. Each one works for {ttlDays} days, in one browser.
        </span>
      </div>
      {atLimit && (
        <Alert tone="warning" className="mt-4">
          You have {maxActive} active pairings, the most allowed. Revoke one you no longer use to create another.
        </Alert>
      )}
      <ErrorBox text={error} />
      <div aria-live="polite" className="sr-only">
        {busy ? "Creating the pairing code…" : ""}
      </div>
      <div className="mt-4">
        <Button type="submit" variant="primary" busy={busy} busyLabel="Creating…" disabled={atLimit || !name.trim()}>
          Create pairing code
        </Button>
      </div>
    </form>
  );
}

function TokenReveal({ created, ttlDays, onDone }: { created: Created; ttlDays: number; onDone: () => void }) {
  return (
    <section className={`${card} ${formWidth}`} aria-labelledby="token-title">
      <h2 id="token-title" className={sectionTitle}>
        Pairing code for {created.pairing.label}
      </h2>
      <p role="status" className="text-[13px] font-semibold">
        Copy this code now. It is shown only once.
      </p>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <code className="font-mono font-semibold bg-muted rounded px-2 py-1 break-all text-[13px]">{created.token}</code>
        <CopyButton text={created.token} what="pairing code" />
      </div>
      <p className="text-[12px] text-ink-mute mt-3">
        Paste it on the companion&apos;s Options page. It works for {ttlDays} days, until {created.pairing.expires}, or until you revoke it. Firm OS keeps only a fingerprint of it, so it cannot be shown again; if you lose it, revoke this pairing and create a new one.
      </p>
      <div className="mt-4">
        <button type="button" onClick={onDone} className={ghost}>
          I have copied it
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- list + revoke

function PairingsTable({ pairings, inactiveCount, onRevoked }: { pairings: PairingView[]; inactiveCount: number; onRevoked: () => void }) {
  return (
    <Section id="pairings-title" title={<>Active pairings ({pairings.length})</>} last>
      {pairings.length === 0 ? (
        <EmptyState title="No active pairings">Create a pairing code above, then paste it on the companion&apos;s Options page.</EmptyState>
      ) : (
        <DataTable
          caption="Your active companion pairings, newest first"
          columns={[{ label: "Name" }, { label: "Created" }, { label: "Last used (IST)" }, { label: "Expires" }, { label: "Action", align: "right", srOnly: true }]}
        >
          {pairings.map((p) => (
            <PairingRow key={p.id} pairing={p} onRevoked={onRevoked} />
          ))}
        </DataTable>
      )}
      {inactiveCount > 0 && (
        <p className="text-[12px] text-ink-mute mt-3">
          {inactiveCount} revoked or expired {inactiveCount === 1 ? "pairing is" : "pairings are"} kept for the record. They no longer work.
        </p>
      )}
    </Section>
  );
}

function PairingRow({ pairing, onRevoked }: { pairing: PairingView; onRevoked: () => void }) {
  async function revoke(): Promise<{ ok: boolean; error?: string | null }> {
    try {
      const r = await call(`${API}/${encodeURIComponent(pairing.id)}/revoke`, {});
      if (!r.ok) return { ok: false, error: r.error };
      onRevoked();
      return { ok: true };
    } catch {
      return { ok: false, error: MSG.unreachable };
    }
  }

  return (
    <tr className="border-t border-border hover:bg-muted/40 h-11">
      <td className={`${td} font-semibold break-words`}>{pairing.label}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.created}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.lastUsed ?? <span className="text-ink-mute">Not used yet</span>}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.expires}</td>
      <td className={`${td} text-right`}>
        <ConfirmStep
          label={`Revoke ${pairing.label}`}
          triggerLabel="Revoke"
          triggerAriaLabel={`Revoke ${pairing.label}`}
          triggerVariant="danger"
          confirmLabel="Confirm revoke"
          busyLabel="Revoking…"
          consequence={`The browser using ${pairing.label} stops showing your tasks at its next refresh. This cannot be undone; you can create a new pairing at any time.`}
          onConfirm={revoke}
        />
      </td>
    </tr>
  );
}

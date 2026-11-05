"use client";

// /companion client panel: create a pairing token (shown once, with a copy button), list active
// pairings, revoke one (two steps: Revoke, then Confirm revoke with what it does). Every action
// goes through /api/firm-os/companion/* with the shared call() helper; the list is re-read from the
// server (router.refresh) after each change.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import { btnDanger, btnGhost, btnPrimary, btnSm, call, card, errorText, field } from "@/components/ui";
import { MSG } from "@/lib/companion/messages";
import type { PairingView } from "@/lib/companion/tokens";
import { EmptyState, focusRing, sectionTitle, tableWrap, td, th, thead } from "@/app/agents/parts";

const API = "/api/firm-os/companion/tokens";
const focusField = "focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500";
const label = "text-[11px] font-bold text-ink-mute";
const primary = `${btnPrimary} ${focusRing} inline-flex items-center gap-2`;
const ghost = `${btnGhost} ${focusRing} inline-flex items-center gap-1.5`;

function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px] mt-4">
      {text}
    </div>
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
      {state === "copied" ? "Copied" : state === "blocked" ? "Copy blocked: select the token" : "Copy"}
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
      className={`${card} max-w-[640px]`}
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
        <label htmlFor="companion-label" className={label}>
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
          className={`${field} ${focusField}`}
        />
        <span id="companion-label-help" className="text-[12px] text-ink-mute">
          So you can tell your pairings apart. Each one works for {ttlDays} days, in one browser.
        </span>
      </div>
      {atLimit && (
        <p className="text-[13px] text-amber-800 mt-4">
          You have {maxActive} active pairings, the most allowed. Revoke one you no longer use to create another.
        </p>
      )}
      <ErrorBox text={error} />
      <div aria-live="polite" className="sr-only">
        {busy ? "Creating the pairing token…" : ""}
      </div>
      <div className="mt-4">
        <button type="submit" disabled={busy || atLimit || !name.trim()} className={primary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Create pairing token
        </button>
      </div>
    </form>
  );
}

function TokenReveal({ created, ttlDays, onDone }: { created: Created; ttlDays: number; onDone: () => void }) {
  return (
    <section className={`${card} max-w-[640px]`} aria-labelledby="token-title">
      <h2 id="token-title" className={sectionTitle}>
        Pairing token for {created.pairing.label}
      </h2>
      <p role="status" className="text-[13.5px] font-semibold">
        Copy this token now. It is shown only once.
      </p>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <code className="font-mono font-semibold bg-muted rounded px-2 py-1 break-all text-[13px]">{created.token}</code>
        <CopyButton text={created.token} what="pairing token" />
      </div>
      <p className="text-[12.5px] text-ink-mute mt-3">
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
    <section aria-labelledby="pairings-title">
      <h2 id="pairings-title" className={sectionTitle}>
        Active pairings ({pairings.length})
      </h2>
      {pairings.length === 0 ? (
        <EmptyState title="No active pairings">Create a pairing token above, then paste it on the companion&apos;s Options page.</EmptyState>
      ) : (
        <div className={tableWrap}>
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Your active companion pairings, newest first</caption>
            <thead className={thead}>
              <tr>
                <th scope="col" className={th}>Name</th>
                <th scope="col" className={th}>Created</th>
                <th scope="col" className={th}>Last used (IST)</th>
                <th scope="col" className={th}>Expires</th>
                <th scope="col" className={`${th} text-right`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pairings.map((p) => (
                <PairingRow key={p.id} pairing={p} onRevoked={onRevoked} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inactiveCount > 0 && (
        <p className="text-[12.5px] text-ink-mute mt-3">
          {inactiveCount} revoked or expired {inactiveCount === 1 ? "pairing is" : "pairings are"} kept for the record. They no longer work.
        </p>
      )}
    </section>
  );
}

function PairingRow({ pairing, onRevoked }: { pairing: PairingView; onRevoked: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consequence = `revoke-${pairing.id}`;

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const r = await call(`${API}/${encodeURIComponent(pairing.id)}/revoke`, {});
      if (!r.ok) setError(r.error);
      else onRevoked();
    } catch {
      setError(MSG.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-border h-11 align-top">
      <td className={`${td} font-semibold break-words`}>{pairing.label}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.created}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.lastUsed ?? <span className="text-ink-mute">Not used yet</span>}</td>
      <td className={`${td} tabular-nums whitespace-nowrap`}>{pairing.expires}</td>
      <td className={`${td} text-right`}>
        {confirming ? (
          <div className="flex flex-col items-end gap-2">
            <p id={consequence} className="text-[12.5px] text-ink-soft max-w-[280px] text-left">
              The browser using {pairing.label} stops showing your tasks at its next refresh. This cannot be undone; you can create a new pairing at any time.
            </p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => { setConfirming(false); setError(null); }} className={`${btnGhost} ${focusRing}`}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={revoke} aria-describedby={consequence} className={`${btnDanger} ${focusRing} inline-flex items-center gap-1.5`}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                Confirm revoke
              </button>
            </div>
            {error && (
              <p role="alert" className={`${errorText} text-left max-w-[280px]`}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label={`Revoke ${pairing.label}`} className={`${btnGhost} ${focusRing}`}>
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

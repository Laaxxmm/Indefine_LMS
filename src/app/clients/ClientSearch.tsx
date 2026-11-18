"use client";

// The /clients filter form. Name and client-code searches submit as before (GET, in the page
// address). A PAN, GSTIN, phone number or email — or part of one — never goes in the address: it is
// sent in a request body to /api/clients/lookup, matched exactly, and the result shown here. Part
// of an identifier is refused with a sentence (no prefix matching). DPDP, ADR-006 class A.
import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { call } from "@/components/ui";
import { isSensitiveQuery } from "@/lib/search/query";

type Hit = { id: string; label: string; context: string; href: string };
type Found = { matched: string; hits: Hit[] };

export function ClientSearchForm({ className, children }: { className: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const input = form.elements.namedItem("q") as HTMLInputElement | null;
    const q = input?.value.trim() ?? "";
    setError(null);
    setFound(null);
    if (!q || !isSensitiveQuery(q)) return; // a name or code: the normal GET submit
    e.preventDefault();
    setBusy(true);
    const r = await call("/api/clients/lookup", { q });
    setBusy(false);
    if (input) input.value = ""; // the identifier does not stay on the page either
    if (!r.ok) return setError(r.error);
    setFound({ matched: String(r.data.matched ?? ""), hits: Array.isArray(r.data.hits) ? (r.data.hits as Hit[]) : [] });
  }

  return (
    <>
      <form className={className} onSubmit={onSubmit}>
        {children}
        {busy && <Loader2 className="w-4 h-4 animate-spin self-center text-ink-faint" aria-label="Searching" />}
      </form>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-[12.5px] text-rose-600 -mt-4 mb-6">
            {error}
          </p>
        )}
        {found && (
          <div className="-mt-3 mb-6 rounded-2xl bg-card border border-border shadow-lift p-4 text-[13.5px]">
            <p className="font-semibold mb-2">
              {found.hits.length === 0
                ? `No client you can open has ${found.matched}. Check it and try again, or search by the client's name or code.`
                : `${found.hits.length} client${found.hits.length === 1 ? "" : "s"} with ${found.matched}:`}
            </p>
            {found.hits.length > 0 && (
              <ul className="space-y-1">
                {found.hits.map((h) => (
                  <li key={h.id}>
                    <Link href={h.href} className="font-semibold hover:text-brand-600">
                      {h.label}
                    </Link>{" "}
                    <span className="text-ink-mute">{h.context}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}

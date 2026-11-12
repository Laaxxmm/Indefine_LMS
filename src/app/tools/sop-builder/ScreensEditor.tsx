"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import type { SopScreen } from "@/lib/sop/types";
import { CAPTION_MAX, SCREENS_PER_STEP } from "@/lib/sop/screens";
import { userMessage } from "@/lib/errors";
import { MarkupDialog } from "./MarkupDialog";

type Step = { no: string; action: string; system: string; screens: SopScreen[] };
type Part = { code: string; name: string; steps: Step[] };

const input = "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition";

// Screens per step for the latest version. Each screen is uploaded when it is added (already
// marked up); "Save" makes a new version that shows them.
export function ScreensEditor({ sopId, baseVersionId, nextVersion, parts }: { sopId: string; baseVersionId: string; nextVersion: number; parts: Part[] }) {
  const router = useRouter();
  const [initial] = useState(() => Object.fromEntries(parts.flatMap((p) => p.steps).map((s) => [s.no, s.screens])) as Record<string, SopScreen[]>);
  const [screens, setScreens] = useState(initial);
  const [adding, setAdding] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(screens) !== JSON.stringify(initial);
  const setStep = (no: string, list: SopScreen[]) => setScreens((prev) => ({ ...prev, [no]: list }));

  // Leaving with unsaved screens asks first.
  useEffect(() => {
    if (!changed || saving) return;
    const stay = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [changed, saving]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { baseVersionId, screens: Object.fromEntries(Object.entries(screens).filter(([, list]) => list.length)) };
      const res = await fetch(`/api/tools/sop-builder/sops/${sopId}/screens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "The screens could not be saved. Try again in a minute.");
        setSaving(false);
        return;
      }
      router.push(`/tools/sop-builder/${sopId}`);
      router.refresh();
    } catch (e) {
      setError(userMessage(e));
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 flex items-start gap-2.5 text-[13px] text-amber-900">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">Use the Tally demo company or a test client for screenshots.</p>
          <p>If a real client name, PAN, bank account or amount shows, cover it with the Hide tool before adding the screen. Everyone who reads SOPs sees these screens. They are never sent to the AI.</p>
          <p className="mt-1">To take a screenshot: Win+Shift+S on Windows, Cmd+Ctrl+Shift+4 on a Mac. Then click Add screen and press Ctrl+V.</p>
        </div>
      </div>

      {parts.map((p) => (
        <section key={p.code} className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
          <h2 className="text-[15px] font-bold text-ink mb-3">{p.code} — {p.name}</h2>
          <ol className="space-y-3">
            {p.steps.map((s) => {
              const list = screens[s.no] ?? [];
              return (
                <li key={s.no} className="rounded-xl border border-border p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] font-extrabold text-ink-faint w-14 shrink-0 pt-0.5">{s.no}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] text-ink">{s.action}</p>
                      {s.system && <p className="text-[11.5px] text-ink-faint mt-0.5">{s.system}</p>}
                    </div>
                    <button
                      onClick={() => setAdding(s.no)}
                      disabled={list.length >= SCREENS_PER_STEP || saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-[12.5px] font-semibold text-ink-soft hover:bg-muted disabled:text-ink-faint transition shrink-0"
                    >
                      <Camera className="w-4 h-4" /> Add screen
                    </button>
                  </div>
                  {list.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-3 mt-3 sm:pl-[68px]">
                      {list.map((sc, i) => (
                        <figure key={`${sc.imageId}-${i}`} className="rounded-lg border border-border p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- served by the SOP image route, which checks access */}
                          <img src={`/api/tools/sop-builder/sops/${sopId}/images/${sc.imageId}`} alt={`Screen ${i + 1} for step ${s.no}`} className="w-full h-auto rounded border border-border" />
                          <input
                            value={sc.caption}
                            maxLength={CAPTION_MAX}
                            onChange={(e) => setStep(s.no, list.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
                            placeholder="Caption, e.g. Bank Reconciliation screen"
                            aria-label={`Caption for screen ${i + 1} of step ${s.no}`}
                            className={`${input} mt-2`}
                          />
                          <button onClick={() => setStep(s.no, list.filter((_, j) => j !== i))} disabled={saving} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-rose-600 hover:underline">
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        </figure>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <div className="sticky bottom-0 bg-page/95 backdrop-blur border-t border-border py-3 mt-2">
        <button onClick={save} disabled={!changed || saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save as version {nextVersion}
        </button>
        {!changed && !saving && <span className="ml-3 text-[12px] text-ink-faint">Add or change a screen to save.</span>}
        {error && (
          <p role="alert" className="mt-2.5 text-[13px] text-rose-600 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </p>
        )}
      </div>

      {adding && (
        <MarkupDialog
          sopId={sopId}
          stepNo={adding}
          onClose={() => setAdding(null)}
          onAdded={(sc) => {
            setStep(adding, [...(screens[adding] ?? []), sc]);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

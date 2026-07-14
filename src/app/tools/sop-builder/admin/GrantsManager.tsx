"use client";

import { useState } from "react";
import { UserPlus, X, Loader2 } from "lucide-react";

interface Editor {
  userId: string;
  userName: string;
  userEmail: string;
}
interface Candidate {
  id: string;
  name: string;
  email: string;
}

export function GrantsManager({ initialEditors, candidates: initialCandidates }: { initialEditors: Editor[]; candidates: Candidate[] }) {
  const [editors, setEditors] = useState<Editor[]>(initialEditors);
  const [candidates, setCandidates] = useState<Candidate[]>(initialCandidates);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/sop-builder/grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: pick }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to grant"); return; }
      const c = candidates.find((x) => x.id === pick);
      if (c) setEditors((e) => [...e, { userId: c.id, userName: c.name, userEmail: c.email }].sort((a, b) => a.userName.localeCompare(b.userName)));
      setCandidates((cs) => cs.filter((x) => x.id !== pick));
      setPick("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    const ed = editors.find((e) => e.userId === userId);
    setEditors((e) => e.filter((x) => x.userId !== userId));
    if (ed) setCandidates((cs) => [...cs, { id: ed.userId, name: ed.userName, email: ed.userEmail }].sort((a, b) => a.name.localeCompare(b.name)));
    await fetch(`/api/tools/sop-builder/grants/${userId}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="max-w-2xl">
      <div className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3">Grant editor access</h2>
        <p className="text-[13px] text-ink-mute mb-3">Admins can always create and edit SOPs. Grant an employee editor access to let them create and edit too.</p>
        <div className="flex items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1 rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px]">
            <option value="">Select an employee…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
          </select>
          <button onClick={grant} disabled={!pick || busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold transition">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Grant
          </button>
        </div>
        {error && <p className="text-[12.5px] text-rose-600 mt-2">{error}</p>}
      </div>

      <div className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3">Current editors ({editors.length})</h2>
        {editors.length === 0 ? (
          <p className="text-[13px] text-ink-faint">No employees granted yet — only admins can create/edit SOPs.</p>
        ) : (
          <ul className="divide-y divide-border">
            {editors.map((e) => (
              <li key={e.userId} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-[14px] text-ink truncate">{e.userName}</p>
                  <p className="text-[12px] text-ink-faint truncate">{e.userEmail}</p>
                </div>
                <button onClick={() => revoke(e.userId)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-ink-mute hover:text-rose-600 hover:bg-rose-50 transition">
                  <X className="w-3.5 h-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

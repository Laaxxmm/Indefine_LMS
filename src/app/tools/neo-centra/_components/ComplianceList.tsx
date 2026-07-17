"use client";

import { useMemo, useState } from "react";
import { Check, RotateCcw, Loader2, AlertTriangle, CalendarClock } from "lucide-react";
import { TYPE_LABEL, type ComplianceType } from "@/lib/neo-centra/compliance";

export type Row = {
  key: string;
  type: ComplianceType;
  title: string;
  description: string;
  dueDate: string;
  period: string;
  status: "PENDING" | "DONE";
  completedByName: string | null;
};

const TYPE_BADGE: Record<string, string> = {
  gstr3b: "bg-brand-50 text-brand-700",
  gstr1: "bg-indigo-50 text-indigo-700",
  tds_payment: "bg-amber-50 text-amber-700",
  advance_tax: "bg-rose-50 text-rose-600",
  itr: "bg-emerald-50 text-emerald-700",
  tds_return: "bg-sky-50 text-sky-700",
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function ComplianceList({ fyStart, todayIso, items }: { fyStart: number; todayIso: string; items: Row[] }) {
  const [rows, setRows] = useState(items);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso.slice(0, 10);

  const shown = useMemo(
    () => rows.filter((r) => (type === "all" || r.type === type) && (status === "all" || r.status === status)),
    [rows, type, status],
  );

  async function toggle(row: Row) {
    const next = row.status === "DONE" ? "PENDING" : "DONE";
    setBusy(row.key);
    try {
      const res = await fetch("/api/tools/neo-centra/compliance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fyStart, key: row.key, status: next }),
      });
      if (!res.ok) throw new Error();
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: next, completedByName: next === "DONE" ? "you" : null } : r)));
    } catch {
      // leave unchanged on failure
    } finally {
      setBusy(null);
    }
  }

  const types = Object.keys(TYPE_LABEL) as ComplianceType[];
  const selCls = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">Type</span>
          <select className={selCls} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-mute">Status</span>
          <select className={selCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="PENDING">Pending</option>
            <option value="DONE">Filed</option>
          </select>
        </label>
        <span className="text-[12px] text-ink-faint ml-auto self-center">{shown.length} of {rows.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((r) => {
          const days = daysBetween(r.dueDate, today);
          const overdue = r.status === "PENDING" && days < 0;
          const soon = r.status === "PENDING" && days >= 0 && days <= 7;
          return (
            <div key={r.key} className={`flex items-center gap-3 rounded-xl border p-3.5 transition ${overdue ? "border-rose-200 bg-rose-50/40" : "border-border bg-card"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9.5px] font-extrabold tracking-wide uppercase px-1.5 py-0.5 rounded-full ${TYPE_BADGE[r.type] ?? "bg-muted text-ink-faint"}`}>{TYPE_LABEL[r.type]}</span>
                  <span className="font-semibold text-[13.5px] text-ink truncate">{r.title}</span>
                </div>
                <div className="flex items-center gap-2 text-[11.5px]">
                  <CalendarClock className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  <span className="text-ink-mute">Due {fmtDate(r.dueDate)}</span>
                  {r.status === "DONE" ? (
                    <span className="text-emerald-600 font-semibold">· Filed{r.completedByName ? ` by ${r.completedByName}` : ""}</span>
                  ) : overdue ? (
                    <span className="text-rose-600 font-bold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Overdue by {Math.abs(days)}d</span>
                  ) : soon ? (
                    <span className="text-amber-600 font-bold">· Due in {days}d</span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => toggle(r)}
                disabled={busy === r.key}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition shrink-0 ${r.status === "DONE" ? "border border-border text-ink-mute hover:bg-muted" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
              >
                {busy === r.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : r.status === "DONE" ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                {r.status === "DONE" ? "Reopen" : "Mark filed"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Info,
} from "lucide-react";
import { attendancePct, attendancePoints } from "@/lib/attendance";

type UserLite = { id: string; name: string; email: string };

type SaveRow = {
  userId: string;
  presentDays: number;
  workingDays: number;
  lateMarks: number;
  points: number;
};

type Props = {
  users: UserLite[];
  defaultMonth: string; // "YYYY-MM"
  saveAction: (data: {
    periodMonth: string;
    rows: SaveRow[];
  }) => Promise<{ ok: boolean; error?: string; saved?: number }>;
};

type ReviewRow = {
  key: string;
  csvName: string;
  csvEmail: string;
  userId: string; // "" = unmatched
  presentDays: number;
  workingDays: number;
  lateMarks: number;
  points: number;
  pointsTouched: boolean; // admin manually edited points
  include: boolean;
};

// --- CSV parsing (handles quoted fields, embedded commas/newlines, "" escapes) ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findCol(headers: string[], candidates: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = norm.indexOf(cand);
    if (idx >= 0) return idx;
  }
  for (const cand of candidates) {
    const idx = norm.findIndex((h) => h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function num(s: string | undefined): number {
  if (s == null) return NaN;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export function AttendanceImporter({ users, defaultMonth, saveAction }: Props) {
  const router = useRouter();
  const [periodMonth, setPeriodMonth] = useState(defaultMonth);
  const [defaultWorkingDays, setDefaultWorkingDays] = useState(22);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const byName = new Map(users.map((u) => [normName(u.name || ""), u.id]));

  function buildRows(text: string) {
    setError(null);
    setSuccess(null);
    setInfo(null);
    const grid = parseCsv(text);
    if (grid.length < 2) {
      setError("That file has no data rows. Export the monthly attendance report from greytHR as CSV and upload it.");
      setRows([]);
      return;
    }
    const headers = grid[0];
    const emailCol = findCol(headers, ["email", "email id", "e-mail", "official email", "mail"]);
    const nameCol = findCol(headers, ["employee name", "name", "emp name", "full name"]);
    const presentCol = findCol(headers, ["present days", "days present", "present", "paid days", "payable days"]);
    const workingCol = findCol(headers, ["total working days", "working days", "total days", "month days", "standard days"]);
    const lateCol = findCol(headers, ["late marks", "late mark", "late", "late in", "late count"]);

    if (emailCol < 0 && nameCol < 0) {
      setError("Couldn't find an Employee Name or Email column to match people by. Check the file header row.");
      setRows([]);
      return;
    }
    if (presentCol < 0) {
      setError("Couldn't find a 'Present Days' column. The report needs a present/paid-days column to score attendance.");
      setRows([]);
      return;
    }

    let matched = 0;
    const out: ReviewRow[] = grid.slice(1).map((cells, i) => {
      const csvEmail = emailCol >= 0 ? (cells[emailCol] ?? "").trim() : "";
      const csvName = nameCol >= 0 ? (cells[nameCol] ?? "").trim() : "";
      const userId =
        (csvEmail && byEmail.get(csvEmail.toLowerCase())) ||
        (csvName && byName.get(normName(csvName))) ||
        "";
      if (userId) matched++;

      const presentDays = Math.max(0, num(cells[presentCol]) || 0);
      const workingRaw = workingCol >= 0 ? num(cells[workingCol]) : NaN;
      const workingDays = Number.isFinite(workingRaw) && workingRaw > 0 ? workingRaw : defaultWorkingDays;
      const lateMarks = lateCol >= 0 ? Math.max(0, Math.round(num(cells[lateCol]) || 0)) : 0;
      const pct = attendancePct(presentDays, workingDays);

      return {
        key: `r${i}`,
        csvName,
        csvEmail,
        userId,
        presentDays,
        workingDays,
        lateMarks,
        points: attendancePoints(pct),
        pointsTouched: false,
        include: !!userId,
      };
    });

    setRows(out);
    const unmatched = out.length - matched;
    setInfo(
      `Parsed ${out.length} row${out.length === 1 ? "" : "s"} · ${matched} matched to employees` +
        (unmatched > 0 ? ` · ${unmatched} need a manual match (or untick to skip)` : "") +
        (workingCol < 0 ? ` · no working-days column found, using the default below` : "")
    );
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => buildRows(String(reader.result ?? ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(f);
  }

  function patchRow(key: string, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Recompute points from attendance unless the admin typed a custom points value.
        const editedDays = "presentDays" in patch || "workingDays" in patch;
        if (editedDays && !next.pointsTouched) {
          next.points = attendancePoints(attendancePct(next.presentDays, next.workingDays));
        }
        if ("points" in patch) next.pointsTouched = true;
        return next;
      })
    );
  }

  function save() {
    setError(null);
    setSuccess(null);
    if (!periodMonth) {
      setError("Pick the month this report covers.");
      return;
    }
    const toSave = rows.filter((r) => r.include && r.userId);
    if (toSave.length === 0) {
      setError("Nothing to save — match at least one row to an employee and keep it ticked.");
      return;
    }
    // Guard against the same employee appearing twice in one upload.
    const seen = new Set<string>();
    for (const r of toSave) {
      if (seen.has(r.userId)) {
        const u = users.find((x) => x.id === r.userId);
        setError(`${u?.name ?? "An employee"} is matched to more than one row. Fix or untick the duplicate.`);
        return;
      }
      seen.add(r.userId);
    }

    startSave(async () => {
      const res = await saveAction({
        periodMonth,
        rows: toSave.map((r) => ({
          userId: r.userId,
          presentDays: r.presentDays,
          workingDays: r.workingDays,
          lateMarks: r.lateMarks,
          points: r.points,
        })),
      });
      if (res.ok) {
        setSuccess(`Saved ${res.saved} attendance record${res.saved === 1 ? "" : "s"} — KRA points updated.`);
        setRows([]);
        setFileName(null);
        setInfo(null);
        router.refresh();
      } else {
        setError(res.error || "Failed to save.");
      }
    });
  }

  const includedCount = rows.filter((r) => r.include && r.userId).length;

  return (
    <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
      <h2 className="text-lg font-semibold mb-1">Import monthly attendance</h2>
      <p className="text-sm text-ink-mute mb-5">
        Export the monthly attendance report from{" "}
        <a href="https://streamlining.greythr.com/" target="_blank" rel="noreferrer" className="text-brand-500 underline">
          greytHR
        </a>{" "}
        as CSV and upload it here. Employees are matched by email or name; review and save to award KRA points.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <label className="block">
          <span className="block text-sm text-ink-mute mb-1">Month covered</span>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-ink-mute mb-1">Default working days</span>
          <input
            type="number"
            min={1}
            max={31}
            value={defaultWorkingDays}
            onChange={(e) => setDefaultWorkingDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-ink-mute mb-1">Attendance CSV</span>
          <div className="relative">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onFile}
              className="block w-full text-sm text-ink-mute file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-500 file:text-white file:text-sm file:cursor-pointer hover:file:bg-brand-600"
            />
          </div>
        </label>
      </div>

      {fileName && (
        <p className="text-xs text-ink-mute mb-3 flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5" /> {fileName}
        </p>
      )}

      <div className="rounded-lg bg-brand-50 border border-brand-100 text-brand-700 text-xs px-3 py-2 mb-4 flex items-start gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Scoring: ≥95% = 10 pts · ≥90% = 7 pts · ≥80% = 4 pts · below 80% = 0. Saving the same month again
          overwrites that month&apos;s records.
        </span>
      </div>

      {info && (
        <div className="rounded-lg bg-muted text-ink-soft text-sm px-3 py-2 mb-4">{info}</div>
      )}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2 mb-4 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {success}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-ink-mute">
                <tr>
                  <th className="p-2 w-10"></th>
                  <th className="text-left p-2">From file</th>
                  <th className="text-left p-2">Employee</th>
                  <th className="text-right p-2 w-20">Present</th>
                  <th className="text-right p-2 w-20">Working</th>
                  <th className="text-right p-2 w-16">%</th>
                  <th className="text-right p-2 w-16">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = attendancePct(r.presentDays, r.workingDays);
                  return (
                    <tr
                      key={r.key}
                      className={`border-t border-border ${r.include && r.userId ? "" : "opacity-50"}`}
                    >
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => patchRow(r.key, { include: e.target.checked })}
                          className="accent-brand-500"
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{r.csvName || "—"}</div>
                        {r.csvEmail && <div className="text-xs text-ink-faint">{r.csvEmail}</div>}
                      </td>
                      <td className="p-2">
                        <select
                          value={r.userId}
                          onChange={(e) => patchRow(r.key, { userId: e.target.value })}
                          className={`w-full bg-muted border rounded px-2 py-1 text-sm ${
                            r.userId ? "border-border" : "border-rose-300"
                          }`}
                        >
                          <option value="">— unmatched —</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name || u.email}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={r.presentDays}
                          onChange={(e) => patchRow(r.key, { presentDays: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-full bg-muted border border-border rounded px-2 py-1 text-sm text-right"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={1}
                          value={r.workingDays}
                          onChange={(e) => patchRow(r.key, { workingDays: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-full bg-muted border border-border rounded px-2 py-1 text-sm text-right"
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums text-ink-soft">{pct}%</td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={r.points}
                          onChange={(e) => patchRow(r.key, { points: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-full bg-muted border border-border rounded px-2 py-1 text-sm text-right font-semibold"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={save}
              disabled={saving || includedCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? "Saving…" : `Save ${includedCount} record${includedCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setRows([]);
                setFileName(null);
                setInfo(null);
                setError(null);
              }}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted text-sm disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 text-ink-mute" /> Discard
            </button>
          </div>
        </>
      )}
    </section>
  );
}

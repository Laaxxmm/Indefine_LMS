// Indian FY quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). Turia uses ms epochs.
export type Period = { fromMs: number; toMs: number; label: string; key: string; fyStart: number; q: number };

const endOfDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 23, 59, 59, 999);
const startOfDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 0, 0, 0, 0);
const fyLabel = (s: number) => `FY${s}-${String(s + 1).slice(2)}`;

export function quartersForFy(fyStart: number): Period[] {
  const y2 = fyStart + 1;
  const mk = (q: number, from: number, to: number, label: string): Period => ({ fromMs: from, toMs: to, label: `Q${q} · ${label}`, key: `${fyStart}-Q${q}`, fyStart, q });
  return [
    mk(1, startOfDay(fyStart, 4, 1), endOfDay(fyStart, 6, 30), "Apr–Jun"),
    mk(2, startOfDay(fyStart, 7, 1), endOfDay(fyStart, 9, 30), "Jul–Sep"),
    mk(3, startOfDay(fyStart, 10, 1), endOfDay(fyStart, 12, 31), "Oct–Dec"),
    mk(4, startOfDay(y2, 1, 1), endOfDay(y2, 3, 31), "Jan–Mar"),
  ];
}

export function currentQuarter(nowMs: number): Period {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const fyStart = m >= 4 ? y : y - 1;
  return quartersForFy(fyStart).find((q) => nowMs >= q.fromMs && nowMs <= q.toMs) ?? quartersForFy(fyStart)[0];
}

export { fyLabel };

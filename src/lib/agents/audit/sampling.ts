// Audit sampling (SA 530): a seeded PRNG, random selection and monetary-unit sampling (MUS).
// Reproducible: the same seed string and population always give the same selection. No
// Math.random anywhere; the seed is written into the working papers.
//
// PRNG: the seed string is hashed to 32 bits with FNV-1a (UTF-8 bytes) and drives mulberry32.
// nextFloat() joins two 32-bit outputs into a 53-bit fraction in [0, 1); nextInt(n) = ⌊f × n⌋.
//
// RANDOM: partial Fisher–Yates over the population in file order — for i = 0 … n−1 pick
// j = i + nextInt(N − i) and swap; the first n positions are the sample (reported in file order).
//
// MUS (systematic, random start): book value BV = Σ |amount| (paise, zero items excluded);
// interval J = ⌊BV ÷ n⌋; random start r = 1 + nextInt(J), so 1 ≤ r ≤ J; selection points
// r, r + J, r + 2J, … ≤ BV. Item i covers the monetary units (C(i−1), C(i)] of the running total
// C; an item is selected when a point falls inside it (an item ≥ J is always selected; several
// points in one item select it once). Because r ≤ J and n·J ≤ BV there are at least n points,
// so distinct selections ≤ the number of points.
import { createHash } from "node:crypto";

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(s, "utf8")) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type Prng = { nextUint32(): number; nextFloat(): number; nextInt(n: number): number };

export function createPrng(seed: string): Prng {
  let a = fnv1a32(seed) | 0;
  const nextUint32 = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const nextFloat = () => ((nextUint32() >>> 5) * 67108864 + (nextUint32() >>> 6)) / 9007199254740992; // (a·2^26 + b) / 2^53
  const nextInt = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`nextInt needs a positive integer, got ${n}`);
    return Math.floor(nextFloat() * n);
  };
  return { nextUint32, nextFloat, nextInt };
}

export type SampleItem = { index: number; amountPaise: number };
export type Selection = { index: number; amountPaise: number; point: number | null; hits: number };

export type SampleResult = {
  method: "mus" | "random";
  seed: string;
  populationCount: number;
  populationPaise: number;
  plannedSize: number;
  intervalPaise: number | null;
  randomStart: number | null;
  selections: Selection[];
  selectedPaise: number;
  /** sha256 of "index:amount" of the selections — a short fingerprint for the file. */
  fingerprint: string;
};

const fingerprint = (sel: Selection[]) => createHash("sha256").update(sel.map((s) => `${s.index}:${s.amountPaise}`).join(",")).digest("hex").slice(0, 16);

function result(method: "mus" | "random", seed: string, items: SampleItem[], plannedSize: number, selections: Selection[], intervalPaise: number | null, randomStart: number | null): SampleResult {
  return {
    method,
    seed,
    populationCount: items.length,
    populationPaise: items.reduce((s, i) => s + Math.abs(i.amountPaise), 0),
    plannedSize,
    intervalPaise,
    randomStart,
    selections,
    selectedPaise: selections.reduce((s, x) => s + Math.abs(x.amountPaise), 0),
    fingerprint: fingerprint(selections),
  };
}

export function randomSample(items: SampleItem[], n: number, seed: string): SampleResult {
  const N = items.length;
  const take = Math.max(0, Math.min(n, N));
  const order = items.map((_, i) => i);
  const rng = createPrng(seed);
  for (let i = 0; i < take && take < N; i++) {
    const j = i + rng.nextInt(N - i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picked = order.slice(0, take).sort((a, b) => a - b);
  return result("random", seed, items, take, picked.map((i) => ({ index: items[i].index, amountPaise: items[i].amountPaise, point: null, hits: 1 })), null, null);
}

/** MUS with an explicit random start (pure; used by musSample and by hand-checked tests). */
export function musSelect(items: SampleItem[], n: number, start: number): { intervalPaise: number; selections: Selection[] } {
  const bv = items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
  if (n < 1 || bv === 0) return { intervalPaise: 0, selections: [] };
  const J = Math.floor(bv / n);
  if (J < 1) return { intervalPaise: 0, selections: items.filter((i) => i.amountPaise !== 0).map((i) => ({ index: i.index, amountPaise: i.amountPaise, point: null, hits: 1 })) };
  if (start < 1 || start > J) throw new RangeError(`random start ${start} outside 1…${J}`);
  const out: Selection[] = [];
  let cum = 0;
  let point = start;
  for (const it of items) {
    const a = Math.abs(it.amountPaise);
    if (a === 0) continue;
    const lo = cum;
    cum += a;
    let hits = 0;
    let first: number | null = null;
    while (point <= cum && point <= bv) {
      if (point > lo) {
        hits += 1;
        if (first === null) first = point;
      }
      point += J;
    }
    if (hits) out.push({ index: it.index, amountPaise: it.amountPaise, point: first, hits });
  }
  return { intervalPaise: J, selections: out };
}

export function musSample(items: SampleItem[], n: number, seed: string): SampleResult {
  const bv = items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
  const J = n >= 1 ? Math.floor(bv / n) : 0;
  const start = J >= 1 ? 1 + createPrng(seed).nextInt(J) : 1;
  const { intervalPaise, selections } = musSelect(items, n, start);
  return result("mus", seed, items, n, selections, intervalPaise || null, J >= 1 ? start : null);
}

/** MUS sample size = ⌈BV × CF ÷ TM⌉ with CF in tenths (30 = 3.0). Integer arithmetic. */
export function musSampleSize(bookValuePaise: number, tolerablePaise: number, confidenceFactorTenths: number): number {
  if (tolerablePaise <= 0) return 0;
  const num = BigInt(bookValuePaise) * BigInt(confidenceFactorTenths);
  const den = BigInt(tolerablePaise) * 10n;
  return Number((num + den - 1n) / den);
}

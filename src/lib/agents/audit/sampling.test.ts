import { describe, expect, it } from "vitest";
import { createPrng, fnv1a32, musSample, musSampleSize, musSelect, randomSample } from "./sampling";

const items = (amounts: number[]) => amounts.map((amountPaise, index) => ({ index, amountPaise }));

describe("seeded PRNG", () => {
  it("FNV-1a 32-bit reference values", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
  it("same seed → same stream; different seed → different stream", () => {
    const a = createPrng("FY2025-26/sales");
    const b = createPrng("FY2025-26/sales");
    const c = createPrng("FY2025-26/sales2");
    const sa = Array.from({ length: 5 }, () => a.nextUint32());
    expect(Array.from({ length: 5 }, () => b.nextUint32())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.nextUint32())).not.toEqual(sa);
  });
  it("nextFloat in [0,1), nextInt in [0,n), rejects bad n", () => {
    const r = createPrng("x");
    for (let i = 0; i < 1000; i++) {
      const f = r.nextFloat();
      expect(f >= 0 && f < 1).toBe(true);
      const k = r.nextInt(7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
    expect(() => r.nextInt(0)).toThrow(RangeError);
    expect(() => r.nextInt(1.5)).toThrow(RangeError);
  });
  it("does not use Math.random", () => {
    const orig = Math.random;
    Math.random = () => {
      throw new Error("Math.random used");
    };
    try {
      expect(randomSample(items([1, 2, 3, 4, 5]), 2, "s").selections).toHaveLength(2);
      expect(musSample(items([100, 200, 300]), 2, "s").selections.length).toBeGreaterThan(0);
    } finally {
      Math.random = orig;
    }
  });
});

describe("MUS — interval math (hand-checked)", () => {
  // Amounts 100, 250, 50, 600 → BV 1,000; n = 4 → J = ⌊1000 / 4⌋ = 250.
  // Start r = 100 → points 100, 350, 600, 850.
  // Cumulative ranges: A (0,100], B (100,350], C (350,400], D (400,1000].
  // 100 ∈ A; 350 ∈ B; 600 ∈ D; 850 ∈ D → A, B, D (D twice); C (50 < J) is skipped.
  it("start 100 selects A, B and D (D hit twice)", () => {
    const r = musSelect(items([100, 250, 50, 600]), 4, 100);
    expect(r.intervalPaise).toBe(250);
    expect(r.selections).toEqual([
      { index: 0, amountPaise: 100, point: 100, hits: 1 },
      { index: 1, amountPaise: 250, point: 350, hits: 1 },
      { index: 3, amountPaise: 600, point: 600, hits: 2 },
    ]);
  });
  // Start r = 250 → points 250, 500, 750, 1000: 250 ∈ B; 500, 750, 1000 ∈ D.
  it("start = J (upper boundary) selects B and D; the last point equals BV", () => {
    const r = musSelect(items([100, 250, 50, 600]), 4, 250);
    expect(r.selections.map((s) => [s.index, s.point, s.hits])).toEqual([
      [1, 250, 1],
      [3, 500, 3],
    ]);
  });
  // Start r = 1 → points 1, 251, 501, 751: 1 ∈ A; 251 ∈ B; 501 and 751 ∈ D.
  it("start = 1 (lower boundary)", () => {
    expect(musSelect(items([100, 250, 50, 600]), 4, 1).selections.map((s) => s.index)).toEqual([0, 1, 3]);
  });
  it("an item ≥ J is always selected, whatever the start", () => {
    for (let r = 1; r <= 250; r += 7) expect(musSelect(items([100, 250, 50, 600]), 4, r).selections.some((s) => s.index === 3)).toBe(true);
  });
  it("negative amounts use absolute values; zero items are excluded", () => {
    const r = musSelect(items([-100, 0, 250, -50, 600]), 4, 100);
    expect(r.selections.map((s) => s.index)).toEqual([0, 2, 4]);
  });
  it("start outside 1…J is refused; empty or tiny populations", () => {
    expect(() => musSelect(items([100, 250, 50, 600]), 4, 0)).toThrow(RangeError);
    expect(() => musSelect(items([100, 250, 50, 600]), 4, 251)).toThrow(RangeError);
    expect(musSelect(items([]), 4, 1)).toEqual({ intervalPaise: 0, selections: [] });
    expect(musSelect(items([1, 1]), 0, 1).selections).toEqual([]);
    expect(musSelect(items([1, 1, 0]), 5, 1).selections.map((s) => s.index)).toEqual([0, 1]); // J < 1 → every non-zero item
  });
  it("equal items smaller than J: exactly n distinct selections for every start (fixture design)", () => {
    const pop = items(Array.from({ length: 40 }, () => 30_000_000));
    for (const r of [1, 12_345_678, 47_999_999, 48_000_000]) {
      const s = musSelect(pop, 25, r);
      expect(s.intervalPaise).toBe(48_000_000);
      expect(s.selections).toHaveLength(25);
    }
  });
});

describe("musSample / randomSample — reproducible selections with the seed recorded", () => {
  const pop = items([1200, 50, 7800, 300, 4500, 999, 2500, 61, 10000, 420, 3300, 75]);
  it("same seed → identical selection, start and fingerprint", () => {
    const a = musSample(pop, 4, "CL01/FY2025-26/sales");
    const b = musSample(pop, 4, "CL01/FY2025-26/sales");
    expect(b).toEqual(a);
    expect(a.seed).toBe("CL01/FY2025-26/sales");
    expect(a.method).toBe("mus");
    expect(a.populationPaise).toBe(31_205);
    expect(a.intervalPaise).toBe(7801); // ⌊31205 / 4⌋
    expect(a.randomStart! >= 1 && a.randomStart! <= 7801).toBe(true);
    expect(a.selections.some((s) => s.index === 8)).toBe(true); // 10,000 ≥ J
    expect(a.selectedPaise).toBe(a.selections.reduce((s, x) => s + x.amountPaise, 0));
  });
  it("a different seed moves the random start", () => {
    const starts = new Set(["s1", "s2", "s3", "s4", "s5"].map((s) => musSample(pop, 4, s).randomStart));
    expect(starts.size).toBeGreaterThan(1);
  });
  it("random: n distinct items in file order, reproducible; n ≥ N takes everything", () => {
    const a = randomSample(pop, 5, "seed-A");
    expect(randomSample(pop, 5, "seed-A")).toEqual(a);
    expect(a.selections).toHaveLength(5);
    const idx = a.selections.map((s) => s.index);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    expect(new Set(idx).size).toBe(5);
    expect(randomSample(pop, 5, "seed-B").fingerprint).not.toBe(a.fingerprint);
    expect(randomSample(pop, 99, "x").selections).toHaveLength(12);
    expect(randomSample(pop, 0, "x").selections).toHaveLength(0);
    expect(a.intervalPaise).toBeNull();
    expect(a.randomStart).toBeNull();
  });
  it("MUS with no value has no interval or start", () => {
    const r = musSample(items([0, 0]), 3, "x");
    expect(r).toMatchObject({ intervalPaise: null, randomStart: null, selections: [] });
  });
});

describe("musSampleSize = ⌈BV × CF ÷ TM⌉", () => {
  it("hand-checked", () => {
    expect(musSampleSize(1_200_000_000, 9_000_000, 30)).toBe(400); // 1.2e9 × 3 / 9e6 = 400 exactly
    expect(musSampleSize(1_200_000_001, 9_000_000, 30)).toBe(401); // rounds up
    expect(musSampleSize(100, 0, 30)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { formatCount, formatDayKey, formatInr, MAX_RANGE_DAYS, parseUsageRange, summariseUsage, type UsageCall } from "../usage";

const call = (o: Partial<UsageCall>): UsageCall => ({
  createdAt: new Date("2026-11-05T06:00:00Z"),
  agent: "gst",
  provider: "claude",
  status: "OK",
  escalated: false,
  costInr: 1,
  tokensIn: 10,
  tokensOut: 5,
  ...o,
});

describe("formatInr / formatCount / formatDayKey", () => {
  it("uses Indian digit grouping with two decimals", () => {
    expect(formatInr(123456)).toBe("₹1,23,456.00");
    expect(formatInr(1234567.891)).toBe("₹12,34,567.89");
    expect(formatInr(0)).toBe("₹0.00");
    expect(formatInr(0.0308)).toBe("₹0.03");
    expect(formatInr(-5)).toBe("−₹5.00");
    expect(formatCount(1234567)).toBe("12,34,567");
  });
  it("formats day keys as DD MMM YYYY", () => {
    expect(formatDayKey("2026-11-05")).toBe("05 Nov 2026");
    expect(formatDayKey("bad")).toBe("bad");
  });
});

describe("summariseUsage", () => {
  it("aggregates by IST day, agent and provider with escalations and queued counts", () => {
    const calls = [
      call({ createdAt: new Date("2026-11-04T18:29:59Z"), costInr: 2.5 }), // 23:59 IST on 4 Nov
      call({ createdAt: new Date("2026-11-04T18:30:00Z"), costInr: 1.25, escalated: true }), // 00:00 IST on 5 Nov
      call({ agent: "roc", provider: "grok", costInr: 10 }),
      call({ agent: null, provider: null, status: "QUEUED_FOR_HUMAN", costInr: 0 }),
      call({ agent: "tax", provider: null, status: "BUDGET_REFUSED", costInr: 0 }),
    ];
    const s = summariseUsage(calls);
    expect(s.totals).toMatchObject({ calls: 5, costInr: 13.75, escalations: 1, queued: 1, refused: 1, tokensIn: 50, tokensOut: 25 });
    expect(s.byDay.map((b) => [b.key, b.calls, b.costInr])).toEqual([
      ["2026-11-04", 1, 2.5],
      ["2026-11-05", 4, 11.25],
    ]);
    expect(s.byAgent.map((b) => b.key)).toEqual(["roc", "gst", "tax", "unassigned"]);
    expect(s.byProvider.map((b) => [b.key, b.calls])).toEqual([
      ["grok", 1],
      ["claude", 2],
      ["none", 2],
    ]);
  });
  it("handles no calls", () => {
    expect(summariseUsage([])).toMatchObject({ totals: { calls: 0, costInr: 0 }, byDay: [], byAgent: [], byProvider: [] });
  });
});

describe("parseUsageRange", () => {
  const now = new Date("2026-11-05T13:30:00Z");
  it("defaults to the last 30 IST days, end exclusive", () => {
    const r = parseUsageRange(undefined, undefined, now);
    expect(r.fromKey).toBe("2026-10-07");
    expect(r.toKey).toBe("2026-11-05");
    expect(r.to.toISOString()).toBe("2026-11-05T18:30:00.000Z");
    expect(r.from.toISOString()).toBe("2026-10-06T18:30:00.000Z");
  });
  it("accepts explicit days, swaps reversed ranges, caps at a year", () => {
    expect(parseUsageRange("2026-11-01", "2026-11-03", now)).toMatchObject({ fromKey: "2026-11-01", toKey: "2026-11-03" });
    expect(parseUsageRange("2026-11-03", "2026-11-01", now)).toMatchObject({ fromKey: "2026-11-01", toKey: "2026-11-03" });
    const capped = parseUsageRange("2020-01-01", "2026-11-05", now);
    expect((capped.to.getTime() - capped.from.getTime()) / 86_400_000).toBe(MAX_RANGE_DAYS);
    expect(parseUsageRange("junk", "2026-11-05", now).fromKey).toBe("2026-10-07");
  });
});

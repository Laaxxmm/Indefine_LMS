// The efficiency harness itself: counting wrappers, the SQL estimate, Graph call kinds, row sizes,
// and one agent measured end to end (echo) — the re-run on unchanged inputs makes no model call
// with the production wiring (response cache scoped to the job).
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/agents/core/memory-db";
import { echoAgent } from "@/lib/agents/echo";
import { graphCallKind, instrument, measureAgent, newCounter, relationLoads, sqlFor } from "./efficiency";
import { AGENTS } from "@/lib/agents/registry";
import type { ChecklistPack } from "@/lib/agents/core/checklist";
import { measureCoach, measureViews, rowBytes, valueBytes } from "./efficiency-scenarios";
import { harnessRepo, routerExtras } from "./efficiency-wiring";

describe("counting", () => {
  it("counts delegate calls, inside transactions too, and estimates SQL per relation level", async () => {
    const db = createMemoryDb();
    const c = newCounter();
    instrument(db, c);
    db.seed("sopPack", [{ key: "k", version: "1.0.0", major: 1, minor: 0, title: "k" }]);
    await db.sopPack.findFirst({ where: { key: "k" } });
    await db.$transaction(async (tx) => {
      await tx.sopPack.findMany({});
    });
    expect(c.ops).toEqual({ "sopPack.findFirst": 1, $transaction: 1, "sopPack.findMany": 1 });
    expect(c.sql).toBe(1 + 2 + 1);
    expect(relationLoads({ id: true, jobTask: { select: { firmClient: { select: { clientCode: true } } } }, checklist: { where: { status: "fail" }, select: { severity: true } } })).toBe(3);
    expect(sqlFor("findMany", { select: { _count: { select: { checklist: true } } } })).toBe(2);
  });

  it("names Graph calls by verb and path shape", () => {
    const G = "https://graph.microsoft.com/v1.0";
    expect(graphCallKind("GET", `${G}/sites/x.sharepoint.com:/sites/CL-A`)).toBe("GET site by path");
    expect(graphCallKind("GET", `${G}/drives/d/root:/a/b.xlsx?$select=id`)).toBe("GET item by path");
    expect(graphCallKind("GET", `${G}/drives/d/root:/a:/children?$top=200`)).toBe("GET folder children");
    expect(graphCallKind("GET", `${G}/drives/d/root:/a/b.xlsx:/content`)).toBe("GET file content (download)");
    expect(graphCallKind("PUT", `${G}/drives/d/root:/a/b.xlsx:/content?x=1`)).toBe("PUT file content (upload)");
    expect(graphCallKind("POST", `${G}/$batch`)).toBe("POST $batch");
  });

  it("row sizes: header + columns, plus index entries", () => {
    expect(valueBytes("abc", "text")).toBe(4);
    expect(valueBytes({ a: 1 }, "json")).toBe(Math.ceil(7 * 1.15) + 4);
    expect(valueBytes(null, "ts")).toBe(0);
    const r = rowBytes("ActivityHeartbeat", { userId: "u-01", at: new Date(), source: "lms" });
    expect(r.heap).toBeGreaterThan(28);
    expect(r.index).toBeGreaterThan(0);
  });
});

describe("applied patches (docs/qa/efficiency-patches.md)", () => {
  it("P1 mistakes: one pack read per version; P2 focus: the pack JSON is not re-read; P3 coach: a later run makes no insert", async () => {
    const packs: Record<string, ChecklistPack> = Object.fromEntries(Object.values(AGENTS).map((d) => [d.sopPackKey, d.defaultChecklist]));
    const views = await measureViews(packs);
    const mistakes = Object.entries(views).find(([k]) => k.includes("listMistakes"))![1];
    expect(mistakes.ops["sopPack.findFirst"] ?? 0).toBeLessThan(10); // was one per row (30)
    const focus = Object.entries(views).find(([k]) => k.includes("getNextTaskView"))![1];
    expect(focus.total).toBeLessThanOrEqual(3);
    const { results } = await measureCoach();
    const later = Object.entries(results).find(([k]) => k.includes("a later run"))![1];
    expect(later.ops["coachEvent.createMany"] ?? 0).toBe(0);
    expect(later.total).toBeLessThanOrEqual(4); // was 93
  }, 60_000);
});

describe("measureAgent (echo)", () => {
  it("counts model calls, tokens, Graph and database work; the re-run is served by the response cache", async () => {
    const m = await measureAgent(echoAgent, { extras: routerExtras, repo: harnessRepo });
    expect(m.fixtures).toBeGreaterThan(5);
    expect(m.mismatches).toEqual([]);
    expect(m.perRun.modelCalls).toBeGreaterThan(0);
    expect(m.perRun.tokensIn).toBeGreaterThan(0);
    expect(m.perRun.graphCalls).toBeGreaterThan(0);
    expect(m.perRun.dbOps).toBeGreaterThan(0);
    expect(m.perRun.rerunModelCalls).toBe(0);
    expect(m.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Re-audit NEW-14 (LOW): one person's burst filled both agent-run slots and the 6-deep queue, and
// the next request from anyone was refused. Ported from the re-audit PoC platform.test.ts
// ("agent-run slots"). Each person now gets 1 run at a time and 1 waiting (env-overridable); their
// next request is refused with its own plain sentence while other people still get slots.
import { describe, expect, it, vi } from "vitest";
import { agentRunBusyMessage, createConcurrencyLimiter } from "./concurrency";
import { isPlainMessage } from "@/lib/errors";
import { startAgentRun } from "@/lib/agents/service";
import { echoWorld, user } from "../../../tests/fakes/agent-world";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("NEW-14: per-person agent-run fairness", () => {
  it("PoC: one person's burst takes 1 slot + 1 queue place; their third is refused; someone else still runs", async () => {
    const lim = createConcurrencyLimiter({ max: 2, maxQueue: 6, maxWaitMs: 1000, perKeyActive: 1, perKeyQueued: 1 });
    const gates: (() => void)[] = [];
    const hold = () => new Promise<void>((res) => gates.push(res));
    const priya = Array.from({ length: 8 }, () => lim.run(hold, "user:priya"));
    await tick();
    expect(lim.active).toBe(1); // her own second run waits for her first, even with a slot free
    expect(lim.waiting).toBe(1);
    const refused = await Promise.all(priya.slice(2));
    expect(refused.every((r) => !r.ok && r.reason === "key-busy")).toBe(true);
    const meera = lim.run(async () => "ran", "user:meera");
    expect(await meera).toEqual({ ok: true, value: "ran" }); // the free slot went to another person at once
    gates[0]!(); // Priya's first finishes → her queued run starts
    await tick();
    expect(lim.active).toBe(1);
    expect(lim.waiting).toBe(0);
    gates[1]!();
    await Promise.all(priya);
  });

  it("the sentence is plain, and the service returns it as 503 + Retry-After", async () => {
    const msg = agentRunBusyMessage({ ok: false, reason: "key-busy", retryAfterSec: 60 }, 2);
    expect(isPlainMessage(msg)).toBe(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = echoWorld();
    const runSlots = createConcurrencyLimiter({ max: 2, maxQueue: 6, maxWaitMs: 1000, perKeyActive: 1, perKeyQueued: 0 });
    let release!: () => void;
    void runSlots.run(() => new Promise<void>((r) => (release = r)), "user:u-priya"); // Priya's run in progress
    const second = await startAgentRun(user("priya"), "echo", "job-1", { ...w.deps, runSlots });
    expect(second).toMatchObject({ ok: false, status: 503, retryAfterSec: 60, error: msg });
    release();
  });
});

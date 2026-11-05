// Supervised loop integration: a run misses a case → reviewer proposes a rule → manager approves →
// new SopPack minor version → the next run loads it and catches the case. Plus the guard rails.
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ECHO_CHECKLIST, ECHO_EXTRACT_TASK, echoAgent } from "@/lib/agents/echo";
import { getAgent } from "@/lib/agents/registry";
import type { RuleDefinition } from "./checklist";
import { decideMistake, diffPacks, proposeMistake, replayMistake, type HumanActor, type MistakeDeps } from "./mistakes";
import { runAgent } from "./runner";
import { PASS_VERDICT, RELATED_TASK, echoWorld, rows } from "../../../../tests/fakes/agent-world";

const SHADOW = {
  rows: [
    { ref: "INV-1", party: "Acme Traders", date: "2026-10-05", amountPaise: 1500000 },
    { ref: "INV-9", party: "Shadow Holdings", date: "2026-10-06", amountPaise: 990000 },
  ],
};
const PROPOSAL = {
  id: "echo.watch-shadow",
  title: "Watch-list party (Shadow Holdings)",
  severity: "warn",
  kind: "deterministic",
  check: "echo.party-listed",
  evidence: "party name and row",
  params: { parties: ["Shadow Holdings"] },
};
const reviewer: HumanActor = { kind: "human", userId: "u-ravi", roles: ["staff"] };
const manager: HumanActor = { kind: "human", userId: "u-meera", roles: ["staff", "manager"] };
const partner: HumanActor = { kind: "human", userId: "u-partner", roles: ["staff", "partner"] };

function world() {
  const w = echoWorld({ responses: { [ECHO_EXTRACT_TASK]: SHADOW, [RELATED_TASK]: PASS_VERDICT } });
  const mdeps: MistakeDeps = { db: w.db, now: w.deps.now, agent: (k) => getAgent(k) };
  return { ...w, mdeps };
}

describe("mistake promotion (integration)", () => {
  it("propose → approve → SopPack 1.1.0 → next run catches the case with source 'mistake'", async () => {
    const w = world();
    // 1. First run misses it: every rule passes.
    const first = await runAgent(echoAgent, "job-1", w.deps);
    expect(first.ok && first.summary.byStatus.fail).toBe(0);

    // 2. Reviewer logs the mistake; example defaults to the run's cached extraction.
    const p = await proposeMistake(w.mdeps, "run-1", "Shadow Holdings is on the firm's watch list", PROPOSAL, undefined, reviewer);
    expect(p.ok).toBe(true);
    const id = (p as { data: { id: string } }).data.id;
    const log = rows(w.db, "mistakeLog")[0];
    expect(log).toMatchObject({ agent: "echo", status: "PROPOSED", createdById: "u-ravi", agentRunId: "run-1", promotedToVersion: null });
    expect(log.example).toMatchObject({ runId: "run-1", extracted: SHADOW });

    // Nothing auto-promotes: a run now still uses 1.0.0.
    expect(rows(w.db, "sopPack")).toHaveLength(1);

    // 3. Staff cannot decide; the manager approves.
    expect(await decideMistake(w.mdeps, id, "approve", reviewer)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await decideMistake(w.mdeps, id, "approve", manager)).toEqual({ ok: true, data: { status: "APPROVED", promotedToVersion: "1.1.0" } });

    const packs = rows(w.db, "sopPack");
    expect(packs.map((s) => s.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(packs[0].checklist).toEqual(ECHO_CHECKLIST); // old version untouched
    expect(packs[1]).toMatchObject({ key: "echo", major: 1, minor: 1, patch: 0, active: true, approvedById: "u-meera", title: "Echo" });
    const promoted = (packs[1].checklist as { rules: RuleDefinition[] }).rules.at(-1)!;
    expect(promoted).toMatchObject({ id: "echo.watch-shadow", origin: { type: "mistake", mistakeLogId: id, promotedInVersion: "1.1.0" } });
    expect(rows(w.db, "mistakeLog")[0]).toMatchObject({ status: "APPROVED", promotedToVersion: "1.1.0", decidedById: "u-meera" });
    expect(rows(w.db, "auditEvent").at(-1)).toMatchObject({ action: "approve", entity: "MistakeLog", entityId: id });

    // 4. Next run (re-run on the same job) loads 1.1.0 and catches it.
    await w.db.jobTask.update({ where: { id: "job-1" }, data: { state: "IN_PREP" } });
    const second = await runAgent(echoAgent, "job-1", w.deps);
    expect(second.ok).toBe(true);
    expect(rows(w.db, "agentRun")[1].sopPackVersion).toBe("1.1.0");
    const caught = rows(w.db, "checklistResult").filter((r) => r.agentRunId === "run-2" && r.ruleId === "echo.watch-shadow");
    expect(caught).toEqual([expect.objectContaining({ status: "fail", severity: "warn", source: "mistake", evidence: { quote: "Shadow Holdings", location: "register.csv row 3" } })]);

    // 5. The example replays: the promoted rule catches it.
    expect((await replayMistake(echoAgent, promoted, rows(w.db, "mistakeLog")[0].example)).caught).toBe(true);
  });

  it("an approved mistake whose rule is not in the active pack is still applied (from MistakeLog)", async () => {
    const w = world();
    w.db.seed("mistakeLog", [{ agent: "echo", pattern: "p", ruleProposal: PROPOSAL, status: "APPROVED", promotedToVersion: "1.1.0", createdById: "u" }]);
    await runAgent(echoAgent, "job-1", w.deps);
    expect(rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.watch-shadow")).toMatchObject({ status: "fail", source: "mistake" });
  });

  it("reject marks the row only; decisions are final", async () => {
    const w = world();
    await runAgent(echoAgent, "job-1", w.deps);
    const p = await proposeMistake(w.mdeps, "run-1", "f", PROPOSAL, undefined, reviewer);
    const id = (p as { data: { id: string } }).data.id;
    expect(await decideMistake(w.mdeps, id, "reject", partner)).toEqual({ ok: true, data: { status: "REJECTED", promotedToVersion: null } });
    expect(rows(w.db, "sopPack")).toHaveLength(1);
    expect(await decideMistake(w.mdeps, id, "approve", partner)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await decideMistake(w.mdeps, "missing", "approve", partner)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("two promotions in a row give 1.1.0 then 1.2.0", async () => {
    const w = world();
    await runAgent(echoAgent, "job-1", w.deps);
    const a = await proposeMistake(w.mdeps, "run-1", "a", PROPOSAL, undefined, reviewer);
    const b = await proposeMistake(w.mdeps, "run-1", "b", { ...PROPOSAL, id: "echo.big", check: "echo.amount-over", params: { limitPaise: 1000000 } }, undefined, reviewer);
    await decideMistake(w.mdeps, (a as { data: { id: string } }).data.id, "approve", partner);
    expect(await decideMistake(w.mdeps, (b as { data: { id: string } }).data.id, "approve", partner)).toMatchObject({ ok: true, data: { promotedToVersion: "1.2.0" } });
    const latest = rows(w.db, "sopPack").at(-1)!.checklist as { rules: { id: string }[] };
    expect(latest.rules.map((r) => r.id).slice(-2)).toEqual(["echo.watch-shadow", "echo.big"]);
  });
});

describe("proposal guard rails", () => {
  it("rejects invalid, unregistered, duplicate and example-less proposals", async () => {
    const w = world();
    await runAgent(echoAgent, "job-1", w.deps);
    expect(await proposeMistake(w.mdeps, "nope", "f", PROPOSAL, undefined, reviewer)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await proposeMistake(w.mdeps, "run-1", " ", PROPOSAL, undefined, reviewer)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await proposeMistake(w.mdeps, "run-1", "f", { id: "X" }, undefined, reviewer)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await proposeMistake(w.mdeps, "run-1", "f", { ...PROPOSAL, check: "echo.nope" }, undefined, reviewer)).toMatchObject({
      ok: false,
      code: "INVALID",
      reason: expect.stringMatching(/choose one of: echo.duplicate-refs/),
    });
    expect(await proposeMistake(w.mdeps, "run-1", "f", { ...PROPOSAL, id: "echo.duplicate-refs" }, undefined, reviewer)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await proposeMistake(w.mdeps, "run-1", "f", PROPOSAL, { notExtracted: true, extracted: undefined }, reviewer)).toMatchObject({ ok: false, code: "INVALID" });
    await w.db.agentRun.update({ where: { id: "run-1" }, data: { inputs: Prisma.DbNull } });
    expect(await proposeMistake(w.mdeps, "run-1", "f", PROPOSAL, undefined, reviewer)).toMatchObject({ ok: false, code: "INVALID", reason: expect.stringMatching(/expired/) });
    // An LLM rule needs no registry entry.
    const llm = { id: "echo.ask", title: "Ask", severity: "info", kind: "llm", check: "Is anything odd?", evidence: "row" };
    expect(await proposeMistake(w.mdeps, "run-1", "f", llm, { extracted: SHADOW }, reviewer)).toMatchObject({ ok: true });
  });

  it("decision fails cleanly for unknown agents, missing packs and stale proposals", async () => {
    const w = world();
    w.db.seed("mistakeLog", [
      { id: "m-agent", agent: "ghost", pattern: "p", ruleProposal: PROPOSAL, createdById: "u" },
      { id: "m-bad", agent: "echo", pattern: "p", ruleProposal: { ...PROPOSAL, check: "echo.nope" }, createdById: "u" },
      { id: "m-dup", agent: "echo", pattern: "p", ruleProposal: { ...PROPOSAL, id: "echo.round-amounts" }, createdById: "u" },
    ]);
    expect(await decideMistake(w.mdeps, "m-agent", "approve", partner)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await decideMistake(w.mdeps, "m-bad", "approve", partner)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await decideMistake(w.mdeps, "m-dup", "approve", partner)).toMatchObject({ ok: false, code: "CONFLICT" });
    const empty = echoWorld({ pack: false });
    empty.db.seed("mistakeLog", [{ id: "m1", agent: "echo", pattern: "p", ruleProposal: PROPOSAL, createdById: "u" }]);
    expect(await decideMistake({ db: empty.db, now: empty.deps.now, agent: getAgent }, "m1", "approve", partner)).toMatchObject({ ok: false, code: "INVALID" });
    empty.db.seed("sopPack", [{ key: "echo", version: "1.0.0", major: 1, minor: 0, title: "Echo", checklist: { broken: true } }]);
    expect(await decideMistake({ db: empty.db, now: empty.deps.now, agent: getAgent }, "m1", "approve", partner)).toMatchObject({ ok: false, code: "INVALID" });
    // Version clash (another 1.1.0 already exists) rolls the whole decision back.
    w.db.seed("mistakeLog", [{ id: "m-ok", agent: "echo", pattern: "p", ruleProposal: PROPOSAL, createdById: "u" }]);
    w.db.seed("sopPack", [{ key: "echo", version: "1.1.0", major: 1, minor: 0, patch: 9, title: "Echo", checklist: ECHO_CHECKLIST, active: false }]);
    expect(await decideMistake(w.mdeps, "m-ok", "approve", partner)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(rows(w.db, "mistakeLog").find((m) => m.id === "m-ok")!.status).toBe("PROPOSED");
  });
});

describe("diffPacks / replayMistake", () => {
  it("lists added, removed and changed rules", () => {
    const b = {
      ...ECHO_CHECKLIST,
      version: "1.1.0",
      rules: [
        { ...ECHO_CHECKLIST.rules[0], severity: "warn" as const },
        ...ECHO_CHECKLIST.rules.slice(2),
        { ...PROPOSAL, severity: "warn" as const, kind: "deterministic" as const },
      ],
    };
    const d = diffPacks(ECHO_CHECKLIST, b);
    expect(d).toMatchObject({ from: "1.0.0", to: "1.1.0" });
    expect(d.added.map((r) => r.id)).toEqual(["echo.watch-shadow"]);
    expect(d.removed.map((r) => r.id)).toEqual(["echo.round-amounts"]);
    expect(d.changed).toEqual([{ id: "echo.duplicate-refs", fields: [{ field: "severity", before: "block", after: "warn" }] }]);
  });

  it("replay: caught / not caught / invalid example / LLM rule with a recorded verdict", async () => {
    const rule = PROPOSAL as RuleDefinition;
    expect((await replayMistake(echoAgent, rule, { extracted: SHADOW })).caught).toBe(true);
    expect((await replayMistake(echoAgent, rule, { extracted: { rows: [] } })).caught).toBe(false);
    expect(await replayMistake(echoAgent, rule, null)).toMatchObject({ caught: false, reason: "example is not valid" });
    expect(await replayMistake(echoAgent, { ...rule, check: "echo.nope" }, { extracted: SHADOW })).toMatchObject({ caught: false });
    const llm = { id: "echo.ask", title: "Ask", severity: "warn", kind: "llm", check: "Odd?", evidence: "row" } as RuleDefinition;
    const verdict = { status: "fail", evidence: { quote: "Shadow Holdings", location: "row 3" } };
    expect((await replayMistake(echoAgent, llm, { extracted: SHADOW, llmVerdict: verdict })).caught).toBe(true);
    expect((await replayMistake(echoAgent, llm, { extracted: SHADOW })).caught).toBe(false);
  });
});

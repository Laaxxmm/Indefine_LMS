// Supervised learning loop (Phase 4 task 4). A reviewer logs a finding the agent missed or got
// wrong, with a proposed checklist rule and an example → MistakeLog PROPOSED. A partner approves
// it (an SOP rule change is a partner decision, Phase 11) → a NEW SopPack row (minor version bump, via withPromotedRule) carrying the
// rule, and the MistakeLog becomes APPROVED with promotedToVersion; the next run loads that pack.
// Rejection only marks the row. Nothing auto-promotes and nothing is edited in place or removed.
// `replayMistake` re-checks a promoted rule against the mistake's example (accuracy harness).
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { logAudit } from "@/lib/audit/log";
import {
  ChecklistPackSchema,
  MistakeRuleProposalSchema,
  loadRuleSet,
  runChecklist,
  withPromotedRule,
  type ChecklistPack,
  type ChecklistResultItem,
  type RuleDefinition,
} from "./checklist";
import type { AnyAgent, FirmDb, JobContext } from "./runner";
import { latestPackQuery } from "./runner";
import type { Actor } from "./state";

export type HumanActor = Extract<Actor, { kind: "human" }>;

export type MistakeDeps = {
  db: FirmDb;
  now: () => Date;
  /** Agent definition by key (registry). */
  agent: (key: string) => AnyAgent | undefined;
};

export type MistakeResult<T> = { ok: true; data: T } | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT"; reason: string };

/** What a promoted rule is replayed against: the run's extracted data (and input, if the agent's compute needs it). */
export const MistakeExampleSchema = z
  .object({
    runId: z.string().optional(),
    job: z.record(z.unknown()).optional(),
    input: z.unknown().optional(),
    extracted: z.unknown(),
    /** For an LLM rule: the verdict a correct model gives on this example (quote + location). */
    llmVerdict: z
      .object({ status: z.enum(["pass", "fail", "na"]), message: z.string().optional(), evidence: z.object({ quote: z.string().min(1), location: z.string().min(1) }) })
      .optional(),
  })
  .refine((e) => e.extracted !== undefined, { message: "example.extracted is required" });
export type MistakeExample = z.infer<typeof MistakeExampleSchema>;

/** SOP rule changes are partner decisions (src/lib/rbac/policy.ts canApproveSopRuleChange). */
const canDecide = (by: HumanActor) => by.roles.includes("partner");

function validateProposal(def: AnyAgent, proposal: unknown): { ok: true; rule: Omit<RuleDefinition, "origin"> } | { ok: false; reason: string } {
  const p = MistakeRuleProposalSchema.safeParse(proposal);
  if (!p.success) return { ok: false, reason: `Rule proposal is not valid: ${p.error.issues.map((i) => `${i.path.join(".") || "rule"}: ${i.message}`).join("; ")}` };
  if (p.data.kind === "deterministic" && !def.checklistRegistry.has(p.data.check)) {
    return { ok: false, reason: `No ${def.key} check is registered as "${p.data.check}"; choose one of: ${[...def.checklistRegistry.keys()].join(", ")}` };
  }
  return { ok: true, rule: p.data };
}

async function latestPack(db: FirmDb, key: string) {
  return db.sopPack.findFirst({ ...latestPackQuery(key) });
}

/** Reviewer logs a missed / wrong finding against a run. Any person who can see the run may propose. */
export async function proposeMistake(
  deps: MistakeDeps,
  runId: string,
  finding: string,
  ruleProposal: unknown,
  example: unknown,
  by: HumanActor,
): Promise<MistakeResult<{ id: string }>> {
  const run = await deps.db.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, agent: true, inputs: true, jobTask: { select: { id: true, title: true, service: true, fy: true, period: true } } },
  });
  if (!run) return { ok: false, code: "NOT_FOUND", reason: `Run ${runId} not found` };
  const def = deps.agent(run.agent);
  if (!def) return { ok: false, code: "INVALID", reason: `Unknown agent ${run.agent}` };
  const pattern = finding.trim();
  if (!pattern) return { ok: false, code: "INVALID", reason: "Describe what the agent missed or got wrong" };
  const v = validateProposal(def, ruleProposal);
  if (!v.ok) return { ok: false, code: "INVALID", reason: v.reason };

  const pack = await latestPack(deps.db, def.sopPackKey);
  const packRules = ((pack?.checklist as { rules?: { id: string }[] } | null)?.rules ?? []).map((r) => r.id);
  if (packRules.includes(v.rule.id)) return { ok: false, code: "CONFLICT", reason: `Rule ${v.rule.id} already exists in ${def.sopPackKey} ${pack?.version}` };
  const pending = await deps.db.mistakeLog.findMany({ where: { agent: def.key, status: "PROPOSED" }, select: { ruleProposal: true } });
  if (pending.some((p) => (p.ruleProposal as { id?: unknown } | null)?.id === v.rule.id)) return { ok: false, code: "CONFLICT", reason: `A proposal for rule ${v.rule.id} is already waiting for a decision` };

  // Example: as given, or the run's own cached extraction.
  const cached = run.inputs as { extracted?: unknown } | null;
  const exampleValue = example ?? (cached?.extracted !== undefined ? { runId, job: run.jobTask, extracted: cached.extracted } : undefined);
  const ex = MistakeExampleSchema.safeParse(exampleValue);
  if (!ex.success) return { ok: false, code: "INVALID", reason: "An example is needed (the run's cached inputs have expired; attach the extracted data)" };

  const created = await deps.db.mistakeLog.create({
    data: {
      agent: def.key,
      pattern,
      ruleProposal: v.rule as Prisma.InputJsonValue,
      example: ex.data as Prisma.InputJsonValue,
      agentRunId: runId,
      createdById: by.userId,
    },
    select: { id: true },
  });
  return { ok: true, data: { id: created.id } };
}

export type Decision = "approve" | "reject";

/** Partner decision. Approve → new SopPack minor version with the rule; reject → marked only. */
export async function decideMistake(
  deps: MistakeDeps,
  id: string,
  decision: Decision,
  by: HumanActor,
): Promise<MistakeResult<{ status: "APPROVED" | "REJECTED"; promotedToVersion: string | null }>> {
  if (!canDecide(by)) return { ok: false, code: "FORBIDDEN", reason: "Only a partner may approve or reject a mistake rule" };
  const now = deps.now();
  try {
    return await deps.db.$transaction(async (tx) => {
      const m = await tx.mistakeLog.findUnique({ where: { id } });
      if (!m) return { ok: false, code: "NOT_FOUND", reason: `Mistake ${id} not found` } as const;
      if (m.status !== "PROPOSED") return { ok: false, code: "CONFLICT", reason: `Already ${m.status.toLowerCase()}` } as const;

      if (decision === "reject") {
        const r = await tx.mistakeLog.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "REJECTED", decidedById: by.userId, decidedAt: now } });
        if (r.count !== 1) return { ok: false, code: "CONFLICT", reason: "Decided by someone else meanwhile; reload" } as const;
        await logAudit(tx, { actorId: by.userId, action: "reject", entity: "MistakeLog", entityId: id, meta: { agent: m.agent } });
        return { ok: true, data: { status: "REJECTED" as const, promotedToVersion: null } };
      }

      const def = deps.agent(m.agent);
      if (!def) return { ok: false, code: "INVALID", reason: `Unknown agent ${m.agent}` } as const;
      const v = validateProposal(def, m.ruleProposal);
      if (!v.ok) return { ok: false, code: "INVALID", reason: v.reason } as const;
      const row = await tx.sopPack.findFirst({ ...latestPackQuery(def.sopPackKey) });
      if (!row) return { ok: false, code: "INVALID", reason: `No active SOP pack "${def.sopPackKey}" to promote into` } as const;
      const base = ChecklistPackSchema.safeParse(row.checklist);
      if (!base.success) return { ok: false, code: "INVALID", reason: `SOP pack ${row.key} ${row.version} has no valid checklist` } as const;
      let next: ChecklistPack;
      try {
        next = withPromotedRule(base.data, v.rule, id);
      } catch (e) {
        return { ok: false, code: "CONFLICT", reason: (e as Error).message } as const;
      }
      const [major, minor, patch] = next.version.split(".").map(Number);
      await tx.sopPack.create({
        data: {
          key: row.key,
          version: next.version,
          major,
          minor,
          patch,
          title: row.title,
          calendar: row.calendar === null ? undefined : (row.calendar as Prisma.InputJsonValue),
          checklist: next as unknown as Prisma.InputJsonValue,
          bufferDays: row.bufferDays,
          active: true,
          createdById: by.userId,
          approvedById: by.userId,
          changeNote: `Promoted mistake ${id}: ${m.pattern}`.slice(0, 500),
        },
      });
      const r = await tx.mistakeLog.updateMany({
        where: { id, status: "PROPOSED" },
        data: { status: "APPROVED", decidedById: by.userId, decidedAt: now, promotedToVersion: next.version },
      });
      if (r.count !== 1) throw new Error("Decided by someone else meanwhile; reload");
      await logAudit(tx, { actorId: by.userId, action: "approve", entity: "MistakeLog", entityId: id, meta: { agent: m.agent, ruleId: v.rule.id, promotedToVersion: next.version } });
      return { ok: true, data: { status: "APPROVED" as const, promotedToVersion: next.version } };
    });
  } catch (e) {
    // Unique (key, version): another promotion created the same version first.
    return { ok: false, code: "CONFLICT", reason: `Could not promote: ${(e as Error).message}` };
  }
}

// ------------------------------------------------------------------ display

export type RuleChange = { id: string; fields: { field: string; before: unknown; after: unknown }[] };
export type PackDiff = { from: string; to: string; added: RuleDefinition[]; removed: RuleDefinition[]; changed: RuleChange[] };

const FIELDS = ["title", "severity", "kind", "check", "evidence", "failMessage", "params"] as const;

/** Rule-level difference between two pack versions (for the mistakes admin page). */
export function diffPacks(a: ChecklistPack, b: ChecklistPack): PackDiff {
  const before = new Map(a.rules.map((r) => [r.id, r]));
  const after = new Map(b.rules.map((r) => [r.id, r]));
  const changed: RuleChange[] = [];
  for (const [id, r] of after) {
    const old = before.get(id);
    if (!old) continue;
    const fields = FIELDS.filter((f) => JSON.stringify(old[f] ?? null) !== JSON.stringify(r[f] ?? null)).map((f) => ({ field: f, before: old[f] ?? null, after: r[f] ?? null }));
    if (fields.length) changed.push({ id, fields });
  }
  return {
    from: a.version,
    to: b.version,
    added: b.rules.filter((r) => !before.has(r.id)),
    removed: a.rules.filter((r) => !after.has(r.id)),
    changed,
  };
}

// ------------------------------------------------------------------ replay

const REPLAY_JOB: JobContext = {
  jobTaskId: "replay",
  title: "Replay",
  service: "Books",
  fy: "2026-27",
  period: "Annual",
  clientCode: "REPLAY",
  clientName: "Replay",
  assigneeId: null,
  reviewerId: null,
};

/**
 * Re-run one promoted rule on a mistake's example. Caught = the rule fails (raises the flag).
 * LLM rules use the example's recorded verdict; no model is called.
 */
export async function replayMistake(def: AnyAgent, rule: RuleDefinition, example: unknown): Promise<{ caught: boolean; result: ChecklistResultItem | null; reason?: string }> {
  const ex = MistakeExampleSchema.safeParse(example);
  if (!ex.success) return { caught: false, result: null, reason: "example is not valid" };
  const loaded = loadRuleSet({ schemaVersion: 1, key: def.sopPackKey, version: "0.0.0", rules: [rule] }, def.checklistRegistry);
  if (!loaded.ok) return { caught: false, result: null, reason: loaded.errors.join("; ") };
  const figures = def.compute(ex.data.extracted, ex.data.input);
  const job = { ...REPLAY_JOB, ...(ex.data.job as Partial<JobContext> | undefined) };
  const [result] = await runChecklist(loaded.ruleSet, { input: ex.data.input, extracted: ex.data.extracted, figures, job }, {
    registry: def.checklistRegistry,
    // The recorded verdict's quote is checked against the same documents text a live run shows.
    llmContext: (_rule, ci) => (def.llmContext ? def.llmContext(ci) : JSON.stringify(ci.extracted, null, 2)),
    llmCheck: async () => {
      if (!ex.data.llmVerdict) throw new Error("no recorded verdict in the example");
      return ex.data.llmVerdict;
    },
  });
  return { caught: result?.status === "fail", result: result ?? null };
}

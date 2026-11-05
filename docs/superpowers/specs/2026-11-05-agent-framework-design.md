# Firm OS task-agent framework — Design (Phase 4)

Date: 2026-11-05 · Builds on [agent core](2026-11-05-agent-core-design.md) and [ModelRouter](2026-11-05-model-router-design.md)

## Pieces

| Piece | File | Notes |
|---|---|---|
| SharePoint file write | `src/lib/integrations/sharepoint/graph-client.ts` | `uploadFile` (≤ 4 MB one request, larger via upload session, 320 KiB-multiple chunks, no bearer on the session URL), `downloadFile`, `copyItem` (download + upload, returns sha256), `GraphItem.size` + `file.hashes`. Conflict behaviour is `"fail"` only → `ConflictError`. |
| Versioned store | `src/lib/integrations/sharepoint/deliverable-store.ts` | Compliance drive lookup; create-only uploads that bump `_v{n}` until a name is free; Working → Final copy; sha256 verify (Graph `sha256Hash` when reported, else download + hash). |
| Runner | `src/lib/agents/core/runner.ts` | `runAgent(agentDef, jobTaskId, deps)`; all deps injected (db, router, store, inputs, now, ids). |
| Inputs | `core/inputs.ts` | ClientDocs (name order) + uploads + books exports, 25 MB cap. |
| Mistakes | `core/mistakes.ts` | propose → decide (partner/manager) → new SopPack minor version; `diffPacks`; `replayMistake`. |
| Accuracy | `core/accuracy.ts` (pure), `core/accuracy-run.ts`, `scripts/accuracy.ts` | Thresholds in `ACCURACY_THRESHOLDS`. |
| Test doubles | `core/memory-db.ts`, `core/memory-store.ts`, `core/recorded-router.ts` | Used by the harness and tests; no removal API. |
| Access | `src/lib/agents/access.ts` | Firm roles from `src/lib/access.ts`; buttons derived from `canTransition`. Consolidate with `src/lib/rbac/policy.ts` later. |
| Service / views | `src/lib/agents/service.ts`, `views.ts` | One lib call per route; read models for pages. |
| Echo agent | `src/lib/agents/echo/` | Framework test agent, hidden unless `FIRM_OS_ECHO_AGENT`. |

## AgentDefinition

```ts
interface AgentDefinition<I, E> {
  key: string; title: string; service: FirmService; sopPackKey: string; modelAgent: AgentName;
  inputSchema: ZodType<I, ZodTypeDef, InputFile[]>;       // gathered files → typed input
  extract(ctx: ExtractContext<I>): Promise<E>;            // model calls via ctx.model (router run)
  compute(extracted: E, input: I): Figures;               // deterministic; integer paise
  checklistRegistry: RuleRegistry<CheckInput<I, E>>;
  llmContext?(input: CheckInput<I, E>): string;           // documents shown for LLM rules
  deliverables(ctx: DeliverableContext<I, E>): DeliverableDraft[];
  defaultChecklist: ChecklistPack;                        // SopPack v1.0.0 seed
  internal?: boolean;
}
```

## Runner flow and decisions

1. Preconditions return an error and create **no** AgentRun: job not found, service mismatch, state not ASSIGNED/IN_PREP, no active SopPack.
2. AgentRun RUNNING (attempt = previous runs + 1, `reviewNotes` = the request-changes note). ASSIGNED → IN_PREP by the agent actor.
3. Rules = latest active pack (highest major.minor.patch) + APPROVED MistakeLog rules the pack does not already carry.
4. LLM rules go through the router with `privacy: anonymize-then-cloud`, `difficulty: judgement`, task `<modelAgent>.check:<ruleId>`; the engine re-validates quote + location.
5. Deliverables are built with header `version = attempt` and uploaded create-only to `Working/`; a taken name takes the next `_v{n}`.
6. Results persist in one transaction; then IN_PREP → AGENT_DONE; then the run is AGENT_DONE. Any failure → run FAILED with the error, job stays IN_PREP; files already in Working stay (never deleted).
7. `inputsPurgeAt = finishedAt + 30 days` (ADR-006). The purge job itself is a later phase.

## Review flow

- Submit for review: AGENT_DONE → IN_REVIEW (latest run only).
- Request changes: IN_REVIEW → IN_PREP with the note, old run CHANGES_REQUESTED, new run with the note.
- Approve pack: IN_REVIEW → APPROVED (state machine enforces reviewer / no self-approval / partner + note over block failures), run APPROVED, then each Working file is **copied** (bytes, so sha256 matches the Working row) to `Final/` at the next free `_v{n}` (never overwriting an earlier approval) and a Final Deliverable row is written. A copy failure returns 502 with a "Copy to Final" retry; the retry is idempotent (keyed on sha256).
- Final files keep the blank "Reviewed by" header of the Working file: they are byte copies so the chain Working sha256 = Final sha256 holds. Regenerating with the reviewer name is a later option.
- Comments are append-only AuditEvents (`action: comment`, `entity: AgentRun`); there is no comments table.

## Deviation: the upload verb

Graph has no POST upload for file content: simple upload and upload-session chunks are HTTP PUT. The Path A rule "GET/POST only" is narrowed, not dropped: `"PUT"` appears once in `graph-client.ts` (`UPLOAD_VERB`), used only by `putContent`, which only receives `:/content?@microsoft.graph.conflictBehavior=fail` URLs or a session created with conflictBehavior `fail`. `no-destructive.test.ts` asserts exactly that; every other file keeps the blanket ban. The fake answers PUT only on those two targets; any other non-GET/POST is still 405 + violation.

## Accuracy fixtures

```
fixtures/accuracy/{agent}/{fixtureId}/input/…          files read as InputSource "fixture"
fixtures/accuracy/{agent}/{fixtureId}/recorded.json    { "<router task>": <model output> }
fixtures/accuracy/{agent}/{fixtureId}/expected.json    { description?, job?: {fy, period, title},
                                                         flags: [{ruleId, severity}],
                                                         figures: { name: integer (paise for amounts) },
                                                         deliverables: [{ name, sheets: [name | {name, columns}] }] }
fixtures/accuracy/{agent}/_mistakes/*.json             approved mistakes { id, pattern?, ruleProposal, example }
```

Scoring: flags compared as sets of (severity, ruleId) on run 1; P/R/F1 per severity (micro-averaged); empty = 1.0. Figures exact. Shape = fixed header block + expected sheets and column headers, no extra sheets or files. Every fixture runs 3× and canonical outcomes must be identical. Approved mistakes are promoted into the fixture pack and their examples replayed.

## UI decisions

- Theme: the LMS brand (purple `brand-*`, `ink-*`), not the spec's fallback teal — the spec says extend the existing theme.
- Eyebrows, table heads and section titles use `ink-mute` instead of the family's `ink-faint` (≈ 2:1 on white) for AA.
- Visible focus ring from the Firm OS models page on every control.
- One primary action per screen: the review bar's action; row actions elsewhere are secondary buttons.
- The mistake log lives at `/agents/mistakes` (partners/managers decide, admins view) and `/admin/firm-os/mistakes` (same view inside the admin layout, which admits LMS admins only).

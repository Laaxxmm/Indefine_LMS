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
4. LLM rules go through the router with `privacy: anonymize-then-cloud`, `difficulty: judgement`, task `<modelAgent>.check:<ruleId>`. The engine re-validates every verdict: the location must be non-empty and the quote must occur in the documents text the model was shown for that rule (`agent.llmContext`, default the extraction as JSON; whitespace and letter case normalised, nothing else). A verdict that fails either check — e.g. a fabricated quote or row — is recorded `na` with flag `llm-evidence-missing`, so it can neither raise nor clear a flag. Mistake replay checks recorded verdicts the same way.
5. Deliverables are built with header `version = attempt` and uploaded create-only to `Working/`; a taken name takes the next `_v{n}`.
6. Results persist in one transaction; then IN_PREP → AGENT_DONE; then the run is AGENT_DONE. Any failure → run FAILED with the error, job stays IN_PREP; files already in Working stay (never deleted).
7. `inputsPurgeAt = finishedAt + 30 days` (ADR-006). The purge job itself is a later phase.

## Review flow

- Submit for review: AGENT_DONE → IN_REVIEW (latest run only).
- Request changes: IN_REVIEW → IN_PREP with the note, old run CHANGES_REQUESTED, new run with the note.
- Approve pack: IN_REVIEW → APPROVED (state machine enforces reviewer / no self-approval / partner + note over block failures), run APPROVED, then each Working file is **copied** (bytes, so sha256 matches the Working row) to `Final/` at the next free `_v{n}` (never overwriting an earlier approval) and a Final Deliverable row is written. A copy failure returns 502 with a "Copy to Final" retry; the retry is idempotent (keyed on sha256).
- Final files keep the blank "Reviewed by" header of the Working file: they are byte copies so the chain Working sha256 = Final sha256 holds. Regenerating with the reviewer name is a later option.
- Comments are append-only AuditEvents (`action: comment`, `entity: AgentRun`); there is no comments table.
- Close-loop hook (Phase 8): after each transition it makes (submit, request changes, approve) the service calls `deps.afterTransition` when one is injected. The close loop imports this service, so the service never imports the close loop: the three agents routes wrap their deps with `withCloseLoopHook()` (src/lib/close-loop/defaults.ts), which injects the same `afterTransition` the `/api/firm-os/jobs/[id]/state` route runs. Dependency injection was chosen over a hook registry: no import-order side effects, and tests pass a spy. On approve the hook runs first (`onApproved` copies to Final unless Final rows exist), then `finalizeRun`, which is idempotent and adds nothing after a hook copy. A failing hook is logged and never fails the transition.
- After approval the review screen shows the human close-loop action (src/lib/close-loop/review.ts read model): "Mark filed" (ack ref required for GST / ROC / IncomeTax / TDS) → `/api/firm-os/jobs/[id]/filed`; in CLOSING "Record Turia close" (task ref + minutes) → `/turia-close`, which tries the close gate; the gate's reasons stay on screen until it passes; DONE shows the chip and the cycle time. Firm OS never files: the person files on the portal and records it.

## Deviation: the upload verb

Graph has no POST upload for file content: simple upload and upload-session chunks are HTTP PUT. The Path A rule "GET/POST only" is narrowed, not dropped: `"PUT"` appears once in `graph-client.ts` (`UPLOAD_VERB`), used only by `putContent`, which only receives `:/content?@microsoft.graph.conflictBehavior=fail` URLs or a session created with conflictBehavior `fail`. `no-destructive.test.ts` asserts exactly that; every other file keeps the blanket ban. The fake answers PUT only on those two targets; any other non-GET/POST is still 405 + violation.

## Accuracy fixtures

```
fixtures/accuracy/{agent}/{fixtureId}/input/…          files read as InputSource "fixture"
fixtures/accuracy/{agent}/{fixtureId}/recorded.json    { "<router task>": <model output> }
fixtures/accuracy/{agent}/{fixtureId}/expected.json    { description?, category?: "clean"|"typical-gap"|"trap",
                                                         job?: {fy, period, title},
                                                         flags: [{ruleId, severity}],
                                                         figures: { name: integer (paise for amounts) },
                                                         deliverables: [{ name, sheets: [name | {name, columns}] }] }
fixtures/accuracy/{agent}/_mistakes/*.json             approved mistakes { id, pattern?, ruleProposal, example }
```

Scoring: flags compared as sets of (severity, ruleId) on run 1; P/R/F1 per severity (micro-averaged), printed with support (tp/fp/fn) and `n/a` when nothing was expected or raised. Figures exact. Shape = fixed header block + expected sheets and column headers, no extra sheets or files. Every fixture runs 3× and canonical outcomes must be identical. Approved mistakes are promoted into the fixture pack and their examples replayed.

Hardening after the independent audit (a "pass" could be produced without the agent reading its input):

- **Input is parsed by code.** Figures and deterministic rules must derive from a deterministic parse of `input/` (the agent's `inputSchema` / `extract`), never from a recorded model response. Model calls are for genuine judgement (LLM rules) or for extraction that is then grounded; `recorded.json` holds only such outputs. Recorded responses no run asks for are reported as stale (not gated).
- **Input sensitivity.** `AgentDefinition.probeMutation?(files: InputFile[]): InputFile[]` returns a copy of the files with one material value changed (e.g. one amount + ₹1). For every fixture the harness re-runs the agent on the mutated files with the same recordings; at least one computed figure or raised flag must differ from run 1, the probe run must succeed, and the files must actually change. Agents that are not `internal` must declare it ("input sensitivity: not declared" fails). Own scoreboard row.
- **Split by rule kind, mode-aware gating.** block / warn P/R are reported for deterministic rules, LLM rules and all rules. In **recorded** mode (today) only the deterministic split is gated on the thresholds; the LLM split must match the recordings exactly (a code-path check — e.g. a verdict the engine rejects for a quote not in the input is a missed flag); the combined row is informational; the determinism row reads "3× identical (code path)". In **live** mode (Phase 2b, `--provider`) the LLM split and the combined row are gated on the thresholds too. The scoreboard names the mode. Info flags get an unthresholded row.
- **No thin fixture sets** (production agents; `internal` agents exempt): at least `FIXTURE_MINIMUMS[agent]` fixtures (gst / roc / tax 15, books / audit 10, any other 15), every fixture has `category`, at least one fixture per category, at least one expected block and one expected warn flag across the set. Every fixture (all agents) must have non-empty `figures` when compute returns figures. Expected flags for rules the pack does not have fail the run.
- **Self-tests** (`tests/fixtures/accuracy-selftest/`): the audit's probes are permanent fixtures that must FAIL (input amount + ₹1 with the recording unchanged; a duplicate ref injected only in the input; `_mistakes` removed; an LLM verdict quoting text absent from the input) or document behaviour (a changed stale extraction recording no longer affects figures).

## Agent conventions (owner-approved 2026-11-05)

The conservative answers to the round-2 questions ("Agent conventions to confirm" in PROGRESS.md):

| Agent | Convention | Where |
|---|---|---|
| GST | A credit note dated after the s.34(2) time limit (30 Nov after the FY of its original invoice, `GST_CONFIG.creditNoteDeadlineMonthDay`) does **not** reduce outward liability in the draft: it is excluded from Table 3.1 and the GSTR-1 CDNR / B2CS / HSN figures. `gst.credit-note-time-limit` still blocks and lists it as `time-barred credit note excluded: <no>, ₹<value>`; the GSTR-3B Notes sheet repeats it. GSTR-1 Table 13 still counts the note. The limit is stated in `gst.pack-config`; if the pack's rule parameter differs from the computation's, the rule lists every note the two treat differently. | `gst/compute.ts`, `gst/rules.ts`; fixture 12 |
| GST | ITC on a purchase bill whose ledger the model answered `insufficient_evidence` on (blocked credit or reverse charge; ungrounded answers count the same) is **held back**: not claimed in 4(A)(5), or 4(A)(3) for a reverse-charge bill, until the reviewer answers. Figure `itcHeldBackPaise` (part of the core 3B figure set pinned by every GST fixture), a memo row in Table 4, and the amount in `gst.model-questions` and the client document request. A supplier credit note on such a ledger still reduces ITC; RCM liability is unchanged. Held-back ITC is neither claimed nor reversed: it is not also reversed in 4(B)(1) when the model named a blocked category (formula re-audit NEW-2). | `gst/compute.ts`, `gst/rules.ts`, `gst/deliverables.ts`; fixtures 23, 32 |
| GST | Amounts the previous return carried forward (output tax, reverse-charge tax, 4(A)(3) credit), when the previous-return file states them (`carriedForward`), are **listed, never consumed**: warn `gst.prior-carry-forward` with the amount and head ("adjust it in this return after a partner confirms") and a GSTR-3B Notes row; this period's liability and ITC are computed without them (`na` when the file does not state the field). Formula re-audit NEW-5. | `gst/input.ts`, `gst/rules.ts`, `gst/deliverables.ts`; fixtures 31 (nil), 34 |
| Books | When a prior-month (opening) trial balance is supplied it must balance to the paisa: **warn** `books.prior-tb-balanced` (also when it cannot be read; `na` without one). Only the month-end TB blocks (`books.tb-balanced`). Figures `priorTb{Debit,Credit,Difference}Paise`. | `books/rules.ts`; fixture `trap-prior-month-tb-off-by-1` |
| Review screen | `RunReview.openQuestions` is shown as "Open questions" beside the checklist, abstentions first, marked "Client document request", with the row's evidence and the amount held back. Besides the flagged LLM rows (`core/guardrails/review.ts`) it carries the abstentions an agent reports through its own deterministic rule (`ABSTENTION_RULES` in `views.ts`: `gst.model-questions` with `itcHeldBackPaise`, `books.classification-questions`). No action on the panel; nothing is sent to the client. | `src/lib/agents/views.ts`, `src/app/agents/[agent]/runs/[id]/page.tsx` |

## UI decisions

- Theme: the LMS brand (purple `brand-*`, `ink-*`), not the spec's fallback teal — the spec says extend the existing theme.
- Eyebrows, table heads and section titles use `ink-mute` instead of the family's `ink-faint` (≈ 2:1 on white) for AA.
- Visible focus ring from the Firm OS models page on every control.
- One primary action per screen: the review bar's action; row actions elsewhere are secondary buttons.
- The mistake log lives at `/agents/mistakes` (partners/managers decide, admins view) and `/admin/firm-os/mistakes` (same view inside the admin layout, which admits LMS admins only).

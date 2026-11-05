# ADR-008 — Agent guardrails: stay in the department, never guess

Status: Accepted (implementation in progress), 2026-11-05

## Context

Task agents (GST, ROC, Tax, Books, Audit) use a cloud model for the parts code cannot do: reading
messy text, classifying ledger lines, judgement checks. The owner's requirement: outputs must be
accurate and specific to the department being worked on — no drift into other topics, no
plausible-sounding guesses, no random output.

What already holds before this ADR:

- No code path files, signs, pays or sends (non-negotiable 1; `verify:no-portal`, no sendMail).
- Client PII is masked before any cloud call (ADR-006); local-only tasks never fall through to cloud.
- The model never does arithmetic: totals, tax, ITC, interest, fees are deterministic TypeScript in
  integer paise.
- Every model output must pass a Zod schema; failures and confidence < 0.75 escalate
  FAST → SMART → HARD, then stop with `needsPartnerReview` (ADR-002).
- Every pack is a draft; a human reviewer approves; reviewers' corrections become versioned rules
  only after partner/manager approval (MistakeLog).
- Accuracy gate per agent (block R ≥ 0.98, P ≥ 0.90; figures exact; 3 identical runs), with the
  independent audit's hardening (input must be parsed in code; LLM evidence must quote the input).

What was missing: a per-department scope, grounding of extracted values, a mandatory abstain
option, agreement checks on high-stakes judgements, prompt versioning, and drift monitoring.

## Decision

Every model call made by a production agent passes through these layers. The framework enforces
them; an agent cannot opt out.

1. **Department scope contract.** Each agent declares an `AgentScope`: its department/service, the
   exact model tasks it may run (name, version, output schema, system prompt), and the checklist
   rule ids it owns. `ctx.model()` refuses any task not declared. Every system prompt starts with
   a fixed firm preamble and the department preamble: work only on <department> for Indian
   compliance; use only the documents supplied; never compute totals; never give filing, legal or
   audit-opinion advice; if the documents do not contain the answer, return
   `insufficient_evidence`; output JSON only.
2. **Closed outputs.** Categories are closed enums (e.g. the 17(5) blocked-credit heads, CARO
   clause ids, ITR forms). Every classification enum includes `insufficient_evidence`. Free text is
   limited to evidence quotes and short notes with a length cap. A verdict for a rule id the agent
   does not own is dropped.
3. **Abstain, don't guess.** `insufficient_evidence` is a valid, scored outcome: it becomes a
   reviewer question (or a client document request), never a silent default.
4. **Grounding.** Every extracted value and every LLM verdict carries a source quote and location.
   The framework verifies the quote occurs in the supplied input (whitespace/case-normalised) and
   that any extracted number equals a number present in that source. Ungrounded output is dropped
   and flagged `ungrounded`.
5. **Deterministic cross-checks are mandatory.** Each task registers validators run on its output
   (GSTIN checksum and state code, HSN digit count, PAN structure, amounts tying to register
   totals, category allowed for that section). A failed validator counts as a schema failure and
   escalates.
6. **Agreement on high-stakes judgements.** LLM rules with block severity run twice (the second
   call on a different tier or provider when available); disagreement → `na` with flag
   `model-disagreement` → human decides.
7. **Wrong-department input fails closed.** Each agent sniffs its inputs deterministically (e.g. a
   GST run with no invoice/GSTIN columns, or a file that is a trial balance) and stops with a
   clear message naming the right agent, before any model call.
8. **Versioned prompts.** Prompts live in a code registry as `<agent>.<task>@<version>`; ModelCall
   records task@version. A lock file of prompt hashes is checked in CI: changing a prompt, a schema
   or a model id requires bumping the version and re-running that agent's accuracy gate in the same
   change.
9. **Drift monitoring.** Per agent per day: schema-fail rate, escalation rate, abstain rate,
   ungrounded rate, disagreement rate, and reviewer override rate (request-changes + MistakeLog).
   Shown on /admin/firm-os/models with thresholds; a breach raises an alert. Once a live model key
   exists, a nightly live run of each agent's fixture set (canary) must stay above its gate.

## Consequences

- Fewer, more honest model answers: more questions back to staff instead of confident guesses.
- Slightly higher cost for block-severity judgements (two calls) — bounded by the daily budget.
- A prompt or model change is a tested change, not a silent edit.
- Accuracy harness gains rows: scope violations = 0, ungrounded = 0, disagreement reported.

## Alternatives considered

- Rely on the system prompt alone. Rejected: prompts are advice to the model, not enforcement.
- Fine-tuned or local models only. Deferred to Phase 2b; the same layers apply to the local
  provider unchanged.
- Temperature 0 for determinism. Not available on the current Claude API; determinism comes from
  closed schemas, grounding, agreement checks and deterministic code instead.

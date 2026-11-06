# ADR-002: ModelRouter and providers (Claude now, local model next week)

- **Status:** Accepted, 2026-11-05
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** ADR-006 (data classes), `docs/inventory.md` §8.11 and H-7

## Context

Firm OS agents read client registers, returns and statements. Under DPDP (ADR-006) client personal
data must not reach a cloud model unmasked. The firm wants Claude now, an optional second cloud
provider for outages, and a local open-weight model on office hardware from week 2 so that the most
sensitive work never leaves the office.

The LMS already uses Google Gemini directly, with no router and no masking: `src/lib/gemini.ts`,
`src/lib/quiz-gen.ts`, `src/lib/distill.ts`, `src/lib/transcribe.ts`, `src/lib/auto-quiz.ts`,
`src/lib/sop/gemini.ts`, `src/lib/statutory/digest.ts`.

## Decision

**One entry point.** Every Firm OS model call goes through `src/lib/ai/router.ts`. Provider SDKs
and HTTP endpoints for LLMs are imported only in `src/lib/ai/providers/{claude,grok,local}.ts`.
`npm run verify:ai-boundary` fails on any other import.

**Providers.**

| Provider | File | Week 1 state |
|---|---|---|
| Claude (Anthropic SDK) | `providers/claude.ts` | Active. Model ids from env: `MODEL_FAST` (classify/extract), `MODEL_SMART` (draft/check packs), `MODEL_HARD` (escalation only). Ids are confirmed against Anthropic's current documentation when Phase 2 is built and kept in env, never hard-coded. Requires `ANTHROPIC_API_KEY`. |
| Grok (xAI, OpenAI-compatible) | `providers/grok.ts` | Optional. Disabled when `XAI_API_KEY` is empty. Used for escalation or Claude outage failover, behind the same anonymizer. |
| Local open-weight | `providers/local.ts` | Stub that fails closed: `isAvailable()` is false while `LOCAL_LLM_BASE_URL` is empty; `complete()` throws `ProviderUnavailableError`. Wired in Phase 2b. |

**Privacy tiers decide where a call may go.**

| `privacy` | Allowed providers |
|---|---|
| `local-only` | Local only. If local is unavailable the request is recorded as `QUEUED_FOR_HUMAN` and stops. It never falls through to a cloud provider. |
| `anonymize-then-cloud` | Local if available, else cloud, always after `Anonymizer.mask()`; `unmask()` on the way back. |
| `public` | Any provider; no client data by definition (e.g. a public circular). |

**Routing policy** is a pure, table-tested function `decideRoute()`:

1. `difficulty = 'sop'`: local if available, else Claude fast tier (masked). `local-only` → queue.
2. Output fails its Zod schema, or confidence < `ROUTER_MIN_CONF` (0.75), or the checklist engine flags a contradiction → escalate one tier (fast → smart → hard). At most two escalations; then stop with `needsPartnerReview = true`.
3. `difficulty = 'novel'` (new circular, assessment order, ambiguous ITC, ITAT angle) → mask → Claude hard (Grok if Claude is down) → `needsPartnerReview = true`.
4. Claude 5xx → Grok if configured, otherwise the error is surfaced. No silent success.

**Budget guard.** Per-run `maxCostInr` and a daily cap `AI_DAILY_BUDGET_INR`. Over budget → refused
with a clear error (`BUDGET_REFUSED`), nothing is sent.

**Logging.** Every attempt, including queued and refused ones, writes a `ModelCall` row (schema
already in `prisma/schema.prisma`): run id, agent, task, provider, model, tier, privacy, difficulty,
escalation level, anonymized flag, status, confidence, tokens, cost in ₹, latency, and
`promptHash` = SHA-256 of the **masked** prompt. Raw prompts and outputs are not stored in
`ModelCall`.

**Legacy Gemini.** The LMS learning features stay on Gemini, outside the router: quiz generation,
transcription, distillation (training content), and statutory digests (public portal text). This
is accepted because they process firm training material and public data, not client files.
Two callers may still carry client data and are recorded as known gaps, not fixed by this ADR:

- `src/lib/transcribe.ts` / `src/lib/live/ingest.ts`: Teams live-session recordings and transcripts are sent to Gemini automatically by the 15-minute cron; a session could discuss a real client.
- `src/lib/sop/gemini.ts`: SOP authors' free text is sent unmasked; it may include client names or identifiers used as examples.

No Firm OS file may import `@/lib/gemini`. `verify:ai-boundary` allowlists the legacy files listed
in `docs/inventory.md` H-7 by path and fails on any new Gemini caller.

**Update 2026-11-06 (security audit #7, #11): the two gaps are closed by a mask gate.**

- Every legacy Gemini text prompt goes through `src/lib/ai/legacy-gate.ts` before it leaves:
  `mask()` with the firm's name dictionary (every active client's name and contact plus staff
  names, `src/lib/ai/name-directory.ts`), then the independent leak detector (`detectPii`). If the
  detector still finds client data the call is refused with a plain message and nothing is sent;
  the answer gets the original values back. `callGemini` (SOP Builder, statutory digests),
  `generateQuiz` and `distillTranscript` all gate their own prompts. If the dictionary cannot be
  loaded, SOP Builder and live-session quizzes send nothing (fail closed).
- Live-session recordings: the video is never uploaded to Gemini (an upload cannot be masked). The
  Teams transcript is checked first (`transcriptGate`); when masking cannot cover it — the detector
  still finds client data, or numbers are spoken as words — the session is **parked for an admin**:
  an `AuditEvent` `gemini.parked` (reasons as kinds, never values, and a plain message), no data
  sent, and the 15-minute cron leaves the session alone from then on.
- `verify:ai-boundary` is an import-graph rule (see scripts/lib/guards.ts): the four legacy egress
  files and their direct callers are allow-listed by path with a reason, and each must reach the
  mask gate.

**Gemini data handling (owner to confirm the paid tier).** The legacy features use the Gemini API
with `GEMINI_API_KEY`. Google's Gemini API terms distinguish the free tier (prompts and responses
may be used to improve Google's products and may be reviewed by people) from the paid tier (Cloud
Billing enabled on the key's project: not used for product improvement; kept for a limited period
for abuse monitoring). No request option can opt out of retention, so the tier is the control.
**Owner to confirm the paid tier** is active on the project behind `GEMINI_API_KEY`, and to
re-check Google's current terms; until then, treat every legacy prompt as possibly retained — which
is why the mask gate above applies to all of them.

## Consequences

- Moving to a local model in week 2 changes only `providers/local.ts` and configuration. If any other file must change, the abstraction failed and gets its own ADR.
- `local-only` tasks pile up in a human queue during week 1. That is intended: they are visible work, not silently sent to the cloud.
- Every call is costed and attributable; `/admin/firm-os/models` reports spend by day, agent and provider.
- Prompt hashes allow duplicate detection and audit without keeping client text in the log.
- The two Gemini gaps were closed on 2026-11-06 by the mask gate and the live-session park (see "Legacy Gemini" above); the paid-tier confirmation remains with the owner.

## Alternatives considered

1. **Call providers directly from each agent.** Rejected: masking, budgets and logging would be repeated and eventually missed.
2. **Move the LMS Gemini features into the router now.** Rejected for week 1: it changes working LMS behaviour for no client-data benefit on training content; revisit for the two flagged callers.
3. **Let `local-only` fall back to cloud with masking.** Rejected: masking is a control, not a guarantee; the firm chose to keep that tier off the cloud entirely.
4. **Store raw prompts for debugging.** Rejected under ADR-006; a debug run can use synthetic fixtures instead.

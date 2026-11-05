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

## Consequences

- Moving to a local model in week 2 changes only `providers/local.ts` and configuration. If any other file must change, the abstraction failed and gets its own ADR.
- `local-only` tasks pile up in a human queue during week 1. That is intended: they are visible work, not silently sent to the cloud.
- Every call is costed and attributable; `/admin/firm-os/models` reports spend by day, agent and provider.
- Prompt hashes allow duplicate detection and audit without keeping client text in the log.
- The two Gemini gaps remain until a partner decides (route SOP Builder through the anonymizer, or a notice to staff; confirm recorded sessions never cover client matters).

## Alternatives considered

1. **Call providers directly from each agent.** Rejected: masking, budgets and logging would be repeated and eventually missed.
2. **Move the LMS Gemini features into the router now.** Rejected for week 1: it changes working LMS behaviour for no client-data benefit on training content; revisit for the two flagged callers.
3. **Let `local-only` fall back to cloud with masking.** Rejected: masking is a control, not a guarantee; the firm chose to keep that tier off the cloud entirely.
4. **Store raw prompts for debugging.** Rejected under ADR-006; a debug run can use synthetic fixtures instead.

# ModelRouter, anonymizer and providers — design note (Phase 2)

Date: 2026-11-05 · Module: `src/lib/ai/` · Decision record: [ADR-002](../../adr/ADR-002-model-router.md), [ADR-006](../../adr/ADR-006-dpdp-data-classes.md)

## What was built

| Piece | File | Notes |
|---|---|---|
| Types | `types.ts` (re-exported by `router.ts`) | `Privacy`, `Difficulty`, `ModelRequest`, `ModelResponse`, `ModelProvider` exactly as the orchestrator spec; `AgentTask` is `"<agent>.<task>"`, e.g. `gst.extract-invoices`. |
| Policy | `router.ts` `decideRoute()` | Pure, table-tested. |
| Runner | `router.ts` `run()` / `createRouter(deps)` | Providers, ModelCall repository, config and clock are injected; `run()` wires the env + Prisma defaults lazily. |
| Anonymizer | `anonymizer.ts` | `mask(text, ctx) → { masked, map }`, `unmask(text, map)`, `unmaskDeep`, `detectPii`, validators. |
| Providers | `providers/{claude,grok,local}.ts` | The only files allowed to import `@anthropic-ai/sdk` or name provider hosts (`verify:ai-boundary`). |
| Cost | `pricing.ts`, `config.ts` | USD per million tokens × `USD_INR`. |
| Log | `db.ts` | Append-only `ModelCall` writes + sums; usage query for the admin page. |
| Usage | `usage.ts`, `/admin/firm-os/models` | Pure aggregation by IST day / agent / provider. |

## Routing

The route depends on difficulty and privacy, then on how many escalations have happened:

- `sop`: LOCAL → FAST → SMART when local is up, otherwise FAST → SMART → HARD.
- `judgement`: SMART → HARD. The spec gives no rule for judgement; SMART is the drafting/checking tier it describes.
- `novel`: HARD only. The result always comes back with `needsPartnerReview = true`.
- `local-only` goes to local or to the queue (`QUEUED_FOR_HUMAN`). It never escalates to cloud, at any difficulty.
- Cloud tiers use Claude. When Claude is down they use Grok if `XAI_API_KEY` is set. Otherwise the router throws the Claude error (or `NoProviderAvailableError`).
- Masking is on for every cloud call except `privacy: 'public'`. Calls to the in-house local model are not masked because the data stays on the LAN.

`run()` escalates one tier when the output fails the caller's Zod schema, when confidence is below `ROUTER_MIN_CONF`, or when the optional `contradictions(output)` hook returns issues. The model's reply was not valid JSON or was cut off (`ProviderOutputError`) also counts as a schema failure. There are at most two escalations, and every attempt writes a ModelCall row with `escalationLevel`. After the last allowed failure `run()` returns `{ status: "needs-review", needsPartnerReview: true, issues }` and makes no further calls. On escalation the model gets a short feedback message listing the issues, masked.

Failures and where they go:

- `ProviderUnavailableError` (the local stub, or a key that is missing) and failover-able errors (outage, or a 429 left after retries) mark that provider down for the rest of the run, and the router re-routes.
- If the local stub throws on a non-local-only task, the request moves to Claude FAST, masked. On a local-only task it is queued.
- `auth`, `bad_request` and `refusal` errors are surfaced. They are never retried on another provider, because a refusal sent on to Grok would be a silent policy bypass.

### Confidence contract

Each provider is asked for `{ output, confidence }`, built by `routerOutputJsonSchema(schema)` from the caller's schema. With no schema, `output` is a string. `confidence` is the model's own estimate in [0, 1]; a missing or out-of-range value counts as 0. The system prompt gets a short instruction that explains the field and says to copy placeholders such as `⟨PAN_1⟩` exactly. The caller's Zod schema is converted to JSON Schema by `json-schema.ts`, a small converter for Zod v3, the repo's `zod` import. Types it does not know become a permissive primitive schema. That is safe because every answer is validated against the real Zod schema after it is unmasked, so regexes see real values.

## Anonymizer

The policy is: when unsure, mask. Maskers run in this order:

1. e-mail
2. client-master dictionary (names, companies, addresses; case-insensitive, longest first, any whitespace between words)
3. dates of birth, only near DOB words
4. GSTIN
5. CIN
6. LLPIN, only near "LLP/LLPIN"
7. TAN
8. IFSC
9. PAN
10. Aadhaar
11. bank account, only near account words
12. phone
13. DIN, only near "DIN"
14. PIN code, only near address words or an `⟨ADDRESS_n⟩` token

Notes on individual maskers:

- **GSTIN** is matched by shape. Bad checksums and unknown state codes are masked anyway. The exported `isValidGstin` checks the state code (01–38, 97, 99), the embedded PAN and the mod-36 check character, ready for Phase 3 validators.
- **PAN** uses letter-only lookarounds, so a PAN glued to digits (a mistyped GSTIN) is still caught.
- **Aadhaar** is masked when any of these holds: the Verhoeff checksum is valid; it is written in 4-4-4 groups (defensive); or it is in Aadhaar/UID context. A bare 12-digit number that fails the checksum and has no context (for example an e-way bill number) is left alone.
- **Digit maskers** do not match inside amounts like `1,23,456.00`.

Tokens look like `⟨KIND_n⟩`. One value gets one token per map, keyed on the exact text, so `unmask` round-trips byte for byte. Text that is already a token is never masked again. The map exists only inside one `run()` call. It is never sent, logged or stored, and ModelCall `error` text is masked too.

Tests use a seeded generator of synthetic, checksum-valid identifiers (`__tests__/synthetic.ts`) to build 250 strings. Each string must show no raw value after masking, no hit from `detectPii`, and an exact round-trip. A positive control proves the detector fires on raw text. Ten business strings (invoice numbers, Indian-grouped amounts, HSN/SAC, non-DOB dates, an e-way bill number) must come through unchanged.

## Providers

- **Claude** uses `@anthropic-ai/sdk` 1.5.0 and `messages.create` with `output_config.format = { type: "json_schema" }`. The schema goes through the SDK's own `transformJSONSchema`. Tool use is not used, because current Opus/Sonnet models reject forced `tool_choice`. SDK retries are off. Our loop retries 408, 429, 5xx/529 and connection errors with backoff of 500 ms, 1 s, 2 s, honouring `Retry-After`, up to 30 s. The loop has no jitter, so it is deterministic. Timeout per attempt is `AI_TIMEOUT_MS`, default 60 s. Reported tokens are input + cache read + cache write, and output.
- **Temperature — deviation from the spec.** The spec asks for temperature 0. SDK 1.5.0 sends API version `2026-10-21`, on which `temperature`/`top_p`/`top_k` return HTTP 400 on every model, and the current models accept only the default anyway. The provider therefore sends no sampling parameters. Determinism comes from the schema constraint and validation. Grok still gets `temperature: 0`.
- **Grok** is `fetch` against xAI's OpenAI-compatible chat completions endpoint with a `json_schema` response format. It uses the same retry policy, a timeout through `AbortController`, and is disabled without `XAI_API_KEY`.
- **Local** is the fail-closed stub. Phase 2b replaces only its `complete()`.

## Models and prices

Taken from the `claude-api` skill model table, cached 2026-10-06. Override with env.

| Tier | Default `MODEL_*` | USD / MTok in · out |
|---|---|---|
| FAST | `claude-haiku-5-5` | 0.10 · 0.50 (0.50 · 2.50 above 100K input tokens) |
| SMART | `claude-sonnet-5-5` | 2 · 10 |
| HARD | `claude-opus-5-5` | 4 · 20 |
| Grok | `GROK_MODEL` = `grok-4` | `GROK_PRICE_*`, default 3 · 15 (unverified, configurable) |

An unknown Claude model is priced at 5 · 25, the highest listed rate, so the budget guard over-counts rather than under-counts. `USD_INR` defaults to 88.

## Budget

Before each attempt the router estimates the input cost (about 4 characters per token at the input price) and refuses in either case:

- run spend plus the estimate would exceed `maxCostInr`; run spend is the sum of ModelCall rows with this `runId`
- today's spend plus the estimate would exceed `AI_DAILY_BUDGET_INR`; today is from 00:00 IST via `src/lib/ist.ts`; default 1000, 0 turns the cap off

A refusal writes a `BUDGET_REFUSED` row and throws `BudgetExceededError` with a message that names the limit. The output of the call that crosses the line can overshoot by one call's output tokens.

## Results and logging

`run()` returns one of three shapes:

- `ok`: `ModelResponse` + `needsPartnerReview` + `attempts`
- `needs-review`: the last schema-valid output or `null`, plus `issues`
- `queued`

Tokens and cost in the result are totals across attempts; provider and model are those of the final attempt. Each attempt writes one ModelCall row. Queued, refused and provider-error rows have zero cost. `promptHash` is the SHA-256 of the masked messages, even for `public` and local calls, so a hash can never be brute-forced back to a PAN.

## Not done here / follow-ups

- No live call has been made. A smoke test needs `ANTHROPIC_API_KEY` (and `XAI_API_KEY` for Grok).
- The Grok model id and prices are configurable defaults that have not been checked against xAI's current price list.
- The admin page has not been viewed in a browser against a database with ModelCall rows, because no staging DB is available on this machine.

# Firm OS efficiency report

Owner's brief: keep API calls as few as possible and server space small, without changing any
result, guardrail or security check. This report measures model calls (cost), Microsoft Graph calls
(throttling, latency), database work and storage growth, records what was changed, and lists what
is proposed for the files other agents own (`docs/qa/efficiency-patches.md`).

Base: branch `firm-os/phase-0-inventory` at `09c1a53`. Measured 06 Nov 2026.

## How it was measured

`npx tsx scripts/efficiency-report.ts` (library: `scripts/lib/efficiency.ts`,
`scripts/lib/efficiency-scenarios.ts`; production wiring mirrored in `scripts/lib/efficiency-wiring.ts`).
Nothing touches a network or a database.

- **Agents.** Every accuracy fixture of every agent (echo 9, GST 26, ROC 24, Tax 22, Books 22,
  Audit 22) runs through the real `runAgent` pipeline twice on the same job — the first run, and a
  re-run on unchanged inputs (what "Request changes" or a retry after a SharePoint failure does).
  The **real ModelRouter** runs (masking, budget check, schema and validator checks, escalation,
  ModelCall logging) over a provider that answers from the fixture's `recorded.json` (same lookup as
  the accuracy harness's recorded router), so every attempt — escalations and ADR-008 agreement
  re-asks (`#2`) included — is counted, with input tokens estimated from the exact provider request
  (system prompt + messages + JSON schema, ≈ 4 characters per token) and output tokens from the
  answer. The **real deliverable store and ClientDocs input source** run over the SharePoint fake
  (`tests/fakes/fake-sharepoint.ts`), so Graph calls are counted by verb and path shape. Database
  operations are counted on the in-memory Prisma stand-in (`memory-db.ts`) plus the router's own
  ModelCall insert and budget aggregates. The recorded-router outcome of each fixture (figures,
  flags, statuses, guardrail outcomes) is fingerprinted; the measured pipeline must give the same
  figures and flags (it did, for all 125 fixtures, before and after).
- **Views.** Prisma operations per render on a firm-sized in-memory database: 200 clients, 2,000
  jobs (1,660 done, a working week's worth open), a latest run with 20 checklist rows for each job
  past preparation, 30 mistake-log rows. "SQL statements (est.)" adds one statement per relation
  level a `select` loads (Prisma 6 without the `relationJoins` preview issues one query per level).
  `auth()` (1–2 queries per request for the database session) is not counted.
- **Crons.** The close-loop reconciler on the same firm (30 open close-loop jobs, 160 jobs DONE in
  the last 30 days, each with a Final file in its client's CL- site on the fake SharePoint), run
  twice 30 minutes apart, once with the files already in SharePoint (as after a restart) and once
  with the files written by this process (as `copyToFinal` does); the coach jobs; the daily
  retention job.
- **Storage.** Bytes per row from the rows the runs actually wrote, and a one-year projection with
  the volume assumptions listed under the storage table.

The "before" numbers were measured on the base commit with the same harness
(`docs/qa/efficiency-before.json`); "after" on this branch (`docs/qa/efficiency-after.json`).

## What was changed (this branch)

1. **Model calls — response cache** (`src/lib/ai/cache.ts`, `router.ts`, `config.ts`, `db.ts`).
   The router keeps the validated answer of every "ok" request in a bounded in-process LRU (500
   entries, 4 MB of JSON, 12 h; `AI_RESPONSE_CACHE_MAX=0` turns it off). Key: sha256 of scope,
   `task@version` (+ `#2`), forced tier, privacy, difficulty, token cap, the output JSON schema, the
   masked messages and the sha256 of the raw messages. Scope: the run's JobTask (one client — never
   across clients), else the run. A hit is re-validated against the request's schema and validators
   before use; a hit makes no provider call, writes no ModelCall row and costs nothing. Needs-review,
   queued and failed results are never kept. No prompt text is stored anywhere (keys are hashes);
   outputs live only in process memory.
   *Effect:* a re-run of a job on unchanged inputs makes **no model calls** (was the full set again).
   First runs are unchanged — they were already minimal (below).
2. **Graph — verify by hash, not download** (`quick-xor-hash.ts`, `content-registry.ts`,
   `deliverable-store.ts`, `close-loop/verifier.ts`). The store computes the quickXorHash of every
   file it uploads and compares it with the one Graph reports for the new item; when they agree it
   records `{sha256, quickXorHash, size, cTag}` for that item. The close gate and the reconciler's
   DONE re-check then read only the item's metadata: the SHA-256 is taken as known **only** when
   SharePoint's content tag (cTag — it changes whenever the file's content changes and cannot be set
   by a user), the quickXorHash and the size are all unchanged since we hashed those exact bytes. A
   file edited or replaced in SharePoint always misses and is downloaded and hashed exactly as
   before; quickXorHash (not collision-resistant) is never trusted on its own. A download the gate
   does make is remembered the same way, so after a restart each file is downloaded once, not every
   30 minutes. The gate code (`gate.ts`) is untouched: `getItem` simply reports the SHA-256.
   Algorithm checked against published vectors and a port of Microsoft's reference loop.
3. **Graph — fewer and smaller requests.** Item reads ask for `$select=id,name,size,webUrl,cTag,file,folder`
   (list calls already used `$select`); a client's Compliance drive id is looked up once per store
   (it never changes under Path A); a folder's names are read with one children GET (a missing folder
   is a 404 — the separate item GET is gone) and that listing numbers all deliverables of one run
   (create-only uploads still bump the version on a 409, so a stale name is harmless); `ensureFyTree`
   lists the folders it knows exist in Graph JSON batches (`POST /$batch` with GET sub-requests only;
   a throttled sub-request is retried after its `Retry-After`) — an existing FY tree is read in 7
   requests instead of ~32 (each sub-request still counts against Graph throttling: batching saves
   round trips and latency, not quota); concurrent requests share one token fetch.
4. **Client polling.** *Companion side panel:* refreshes every minute while the same task keeps
   coming back → doubles to at most 5 minutes; any change, an error, the "nothing waiting" view
   (its text promises a check every minute), Refresh, a new token or the panel coming back into view
   restarts at one minute; no timer at all while the panel is hidden. *ActivityPing:* was already
   visibility-gated, interaction-gated (2 min) and ≥ 60 s; it now also backs off (2, 4, 5 min) while
   the server answers "nothing recorded" with no nudge (reminders turned off, or another tab already
   recorded this minute), capped at half the 10-minute break gap so a recorded streak cannot break;
   a recorded heartbeat, a nudge or the tab coming back resets it.

## Patches applied (06 Nov 2026, integration)

The proposed patches P1–P7 of `docs/qa/efficiency-patches.md` are now applied (P3, P5 and P6 by
hand on the current code; P4c in the owner's variant, see below). "Before" here is the same harness
on the integration branch just before the patches (`7c42a4c`, after the security fixes merged);
"after" is the generated block below. Accuracy outcomes are unchanged by the patches.

| Measure | Before patches | After patches |
|---|---:|---:|
| Queries per mistakes-admin render, 30 rows (P1) | 31 | 7 |
| Focus / companion next task: SopPack checklist JSON read per render (P2) | every render | once per pack version per process (3 queries on the first render, 2 after) |
| DB operations per later coach reminder run (P3) | 93 | 4 |
| DB operations per reconciler run, steady state (P4a/b) | 515 | 168 |
| Graph calls per agent run, mean (P5) | 13.21 | 12.21 |
| DB operations per GST agent run, pipeline + ModelCall log (P6) | 32.27 | 28.27 |
| CompanionToken writes per open panel (P7) | 1 a minute | 1 per 10 minutes; unchanged task = 304, no body |

## What was looked at and not changed

- **"Batch per-item classifications into one call per run."** Already the case in every agent:
  GST classifies all purchase ledgers in one `gst.classify-ledgers` call and reads all unreadable
  HSN descriptions in one `gst.read-hsn` call; ROC maps the whole trial balance in one
  `roc.map-ledgers` call; Tax matches all AIS lines in one `tax.match-ais` call; Books classifies all
  unbooked bank debits in one `books.classify-expenses` call; Audit has no extraction call. The only
  per-item calls are the LLM checklist rules (one call per rule — one rule per agent today). Merging
  rules into one call would change the task schema and prompt (version bump, new recordings) and
  lives in `core/guardrails/session.ts` — not changed; proposed for later if agents grow more LLM rules.
- **"Skip the model when code already decided."** Already done: GST reads a plainly printed HSN in
  code and never sends it; Tax skips the call when there are no other-source ledgers; Books skips it
  when the trial balance offers no expense heads; ROC skips it for summary / workbook financials.
  Deciding more items in code (e.g. exact AIS ↔ book matches) would change a judgement the model
  makes today — not done.
- **ADR-008 agreement double-call.** Counted: only the internal echo agent has a block-severity LLM
  rule; GST, ROC, Tax, Books and Audit make **zero** `#2` calls per run (their LLM rules are warn).
  Reading "would the first answer change the outcome" more narrowly is not possible without changing
  ADR-008 semantics (any second answer can turn a pass into `na` + model-disagreement) and the code is
  in `core/guardrails/agreement.ts` / `session.ts` (guardrail-standards agent). Kept as is.
- **Budget reads per model call.** The router reads the day's spend (one indexed aggregate) before
  every attempt. Caching it would let a second process overspend the daily cap — a guardrail — so it
  is unchanged (the cache removes these reads on hits).
- **Anthropic prompt caching.** System prompts are 300–700 tokens, below the 1,024 / 2,048-token
  minimum a cache breakpoint needs; no saving available.
- Route handlers, pages, `runner.ts`, `inputs.ts`, the close-loop reconciler, coach crons, views and
  the schema belong to other agents: the savings there are written as exact patches in
  `docs/qa/efficiency-patches.md` with the numbers below.

## Reading the results

- **First runs make the same model calls** (1.2 a run across the five production agents; 0 `#2`
  re-asks): they were already one call per task per run. The saving is on **re-runs on unchanged
  inputs: 1.2 → 0.03 calls** (₹0.52 → ₹0 per GST re-run at recorded token sizes). The 0.03 left is
  one ROC fixture whose recorded `roc.map-ledgers` answer fails its validator: the router escalates
  and returns needs-review, which is never cached, so a re-run asks again — by design.
- **+1 database read per agent run that calls a model** (`agentRun.findUnique` for the cache scope,
  memoised per run), e.g. GST 27.15 → 28.15. On a re-run every cache hit saves the ModelCall insert
  and the day-budget aggregate (2 queries per call), and the provider call itself.
- **Graph per agent run −28 % (GST −44 %)**: the Compliance drive lookup (2 calls) is made once per
  client per process (the harness counts it on every fixture's first run; in production it is paid
  once per client), and each deliverable no longer costs an item GET + a children GET before its
  upload. The `$select` saving is in bytes, which the fake cannot show (it returns minimal JSON); a
  real SharePoint driveItem without `$select` is ~1.5–2 KB (createdBy, lastModifiedBy,
  parentReference, fileSystemInfo, …) against ~400 B with it.
- **Reconciler**: steady state 380 → 190 Graph calls and **190 → 0 downloads** every 30 minutes
  (each Final file is checked from its metadata). After a restart the first run still downloads
  each DONE file once (190 at this size) and learns it; with the schema addition in the patches doc
  that first run would not download either. The database side (515 operations a run) is unchanged
  here; the proposed patches take it to 148.
- **Storage**: nothing on this branch changes what is stored except that cache hits add no
  ModelCall rows. The largest kept item is the reconciler's `close-refused` AuditEvent on every
  30-minute run for each held job (≈ 49 MiB a year at this size) — proposal P4c, a partner decision.

## Results

<!-- efficiency:data:start -->
_Generated by `npx tsx scripts/efficiency-report.ts` on 2026-11-05T22:52:53.818Z. "Before" = the baseline measured on 2026-11-05T20:30:56.804Z (before); "with patches" = this branch plus the proposed patches in efficiency-patches.md (2026-11-05T20:33:15.524Z). All counts come from instrumented in-memory fakes (no network); see the method section above._

### Summary

| Measure | Before | After (this branch) | Δ | With proposed patches |
|---|---:|---:|---:|---:|
| Model calls per agent run (5 production agents, mean) | 1.2 | 1.22 | +1% | 1.2 |
| Model calls when a job is re-run on unchanged inputs (mean) | 1.2 | 0.02 | -98% | 0.03 |
| Est. ₹ per re-run on unchanged inputs (GST) | 0.52 | 0 | -100% | 0 |
| Graph calls per agent run (mean) | 18.17 | 12.21 | -33% | 12.17 |
| Graph calls per GST run | 25.15 | 13.12 | -48% | 13.15 |
| Graph calls per reconciler run (steady state) | 380 | 190 | -50% | 190 |
| File downloads per reconciler run (steady state) | 190 | 0 | -100% | 0 |
| File downloads, first reconciler run after a restart | 200 | 190 | -5% | 190 |
| Graph calls to read an existing FY tree (ensureFyTree) | ~32 | 7 | −78% | 7 |
| DB operations per reconciler run (steady state) | 515 | 168 | -67% | 148 |
| DB operations per later coach reminder run | 93 | 4 | -96% | 4 |
| DB operations per agent run, GST (pipeline + ModelCall log) | 27.15 | 28.27 | +4% | 24.15 |
| Queries per mistakes-admin render (30 rows) | 31 | 7 | -77% | 7 |
| Kept storage growth, MiB a year | 115.6 | 123.6 | +7% | 66.2 |

### Agents — per run (average over every accuracy fixture)

| Agent | Fixtures | Model calls before | after | Re-run calls before | after | Tokens in / out before | after | Est. ₹/run before | after | DB ops before | after | Graph calls before | after |
|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|
| echo | 9 | 1.78 | 1.78 | 1.78 | 0 | 1,300 / 61 | 1,480 / 61 | 0.42 | 0.47 | 21.67 | 26.33 | 9.44 | 5.78 |
| gst | 33 | 2.08 | 2.09 | 2.08 | 0 | 2,276 / 152 | 2,497 / 153 | 0.52 | 0.56 | 27.15 | 28.27 | 25.15 | 13.12 |
| roc | 26 | 1.25 | 1.23 | 1.25 | 0.12 | 1,126 / 184 | 1,233 / 174 | 0.28 | 0.3 | 22.5 | 25.69 | 19 | 13 |
| tax | 27 | 1.59 | 1.63 | 1.59 | 0 | 1,245 / 89 | 1,432 / 89 | 0.18 | 0.2 | 22.18 | 26.89 | 13.18 | 9.15 |
| books | 26 | 0.09 | 0.15 | 0.09 | 0 | 73 / 7 | 139 / 12 | 0 | 0 | 19.18 | 21.61 | 16.59 | 12.81 |
| audit | 24 | 1 | 1 | 1 | 0 | 1,070 / 63 | 1,174 / 63 | 0.24 | 0.26 | 21 | 25 | 16.95 | 12.96 |

<details><summary>Per agent: model calls by task, database operations, Graph calls</summary>

**echo** (fingerprint of the recorded accuracy outcomes `1bc37a5ef3f5e2d7` — before `6211d47cf39d074e` DIFFERS)

- model calls by task: echo.check:echo.related-party@2 0.89 · echo.check:echo.related-party@2#2 0.89 (before: echo.check:echo.related-party@1 0.89 · echo.check:echo.related-party@1#2 0.89)
- model tier: claude-opus-5-5 0.89 · claude-sonnet-5-5 0.89
- agent pipeline Prisma ops: $transaction 2.78 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 0.89 · agentRun.update 1.89 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 0.89 · deliverable.createMany 0.89 · jobTask.findUnique 2.89 · jobTask.updateMany 1.89 · jobTaskEvent.create 1.89 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 1.78 · modelCall.aggregate (run budget) 1.78 · modelCall.create 1.78 (before: modelCall.aggregate (day budget) 1.78 · modelCall.create 1.78)
- Graph: GET file content (download) 1 · GET folder children 1.89 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 0.89 (before: GET file content (download) 1 · GET folder children 1.89 · GET item by path 1.89 · GET site by path 1.89 · GET site drives 1.89 · PUT file content (upload) 0.89)

**gst** (fingerprint of the recorded accuracy outcomes `ad3b42758db4aebe` — before `e5ca54afc4bc1bb6` DIFFERS)

- model calls by task: gst.check:gst.free-supplies@2 1 · gst.classify-ledgers@2 1 · gst.read-hsn@2 0.09 (before: gst.check:gst.free-supplies@1 1 · gst.classify-ledgers@1 1 · gst.read-hsn@1 0.08)
- model tier: claude-haiku-5-5 0.09 · claude-sonnet-5-5 2
- agent pipeline Prisma ops: $transaction 3 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 1 · agentRun.update 2 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 1 · deliverable.createMany 1 · jobTask.findUnique 3 · jobTask.updateMany 2 · jobTaskEvent.create 2 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 2.09 · modelCall.aggregate (run budget) 2.09 · modelCall.create 2.09 (before: modelCall.aggregate (day budget) 2.08 · modelCall.create 2.08)
- Graph: GET file content (download) 4.12 · GET folder children 2 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 5 (before: GET file content (download) 4.15 · GET folder children 6 · GET item by path 6 · GET site by path 2 · GET site drives 2 · PUT file content (upload) 5)

**roc** (fingerprint of the recorded accuracy outcomes `737a64358e846409` — before `464571af631a5968` DIFFERS)

- model calls by task: roc.check:roc.aoc2-related-party@2 1 · roc.map-ledgers@2 0.23 (before: roc.check:roc.aoc2-related-party@1 1 · roc.map-ledgers@1 0.25)
- model tier: claude-haiku-5-5 0.15 · claude-opus-5-5 0.04 · claude-sonnet-5-5 1.04
- agent pipeline Prisma ops: $transaction 3 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 1 · agentRun.update 2 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 1 · deliverable.createMany 1 · jobTask.findUnique 3 · jobTask.updateMany 2 · jobTaskEvent.create 2 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 1.23 · modelCall.aggregate (run budget) 1.23 · modelCall.create 1.23 (before: modelCall.aggregate (day budget) 1.25 · modelCall.create 1.25)
- Graph: GET file content (download) 7 · GET folder children 2 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 2 (before: GET file content (download) 7 · GET folder children 3 · GET item by path 3 · GET site by path 2 · GET site drives 2 · PUT file content (upload) 2)

**tax** (fingerprint of the recorded accuracy outcomes `a3c73a74245f210a` — before `2ff48d1caf1c13ec` DIFFERS)

- model calls by task: tax.check:tax.foreign-asset@2 1 · tax.match-ais@2 0.63 (before: tax.check:tax.foreign-asset@1 1 · tax.match-ais@1 0.59)
- model tier: claude-haiku-5-5 0.63 · claude-sonnet-5-5 1
- agent pipeline Prisma ops: $transaction 3 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 1 · agentRun.update 2 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 1 · deliverable.createMany 1 · jobTask.findUnique 3 · jobTask.updateMany 2 · jobTaskEvent.create 2 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 1.63 · modelCall.aggregate (run budget) 1.63 · modelCall.create 1.63 (before: modelCall.aggregate (day budget) 1.59 · modelCall.create 1.59)
- Graph: GET file content (download) 4.15 · GET folder children 2 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 1 (before: GET file content (download) 4.18 · GET folder children 2 · GET item by path 2 · GET site by path 2 · GET site drives 2 · PUT file content (upload) 1)

**books** (fingerprint of the recorded accuracy outcomes `d022e7c8a71e75e5` — before `591954c536923ff2` DIFFERS)

- model calls by task: books.classify-expenses@2 0.15 (before: books.classify-expenses@1 0.09)
- model tier: claude-haiku-5-5 0.15
- agent pipeline Prisma ops: $transaction 3 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 0.15 · agentRun.update 2 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 1 · deliverable.createMany 1 · jobTask.findUnique 3 · jobTask.updateMany 2 · jobTaskEvent.create 2 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 0.15 · modelCall.aggregate (run budget) 0.15 · modelCall.create 0.15 (before: modelCall.aggregate (day budget) 0.09 · modelCall.create 0.09)
- Graph: GET file content (download) 7.81 · GET folder children 2 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 1 (before: GET file content (download) 7.59 · GET folder children 2 · GET item by path 2 · GET site by path 2 · GET site drives 2 · PUT file content (upload) 1)

**audit** (fingerprint of the recorded accuracy outcomes `51bcaba7b0d3a752` — before `c2874370690e10cb` DIFFERS)

- model calls by task: audit.check:audit.related-party-disclosure@2 1 (before: audit.check:audit.related-party-disclosure@1 1)
- model tier: claude-sonnet-5-5 1
- agent pipeline Prisma ops: $transaction 3 · agentRun.count 1 · agentRun.create 1 · agentRun.findUnique 1 · agentRun.update 2 · auditEvent.create 1 · auditEvent.findMany 2 · checklistResult.createMany 1 · deliverable.createMany 1 · jobTask.findUnique 3 · jobTask.updateMany 2 · jobTaskEvent.create 2 · mistakeLog.findMany 1 · sopPack.findFirst 1
- router ModelCall log / budget ops: modelCall.aggregate (day budget) 1 · modelCall.aggregate (run budget) 1 · modelCall.create 1 (before: modelCall.aggregate (day budget) 1 · modelCall.create 1)
- Graph: GET file content (download) 7.96 · GET folder children 2 · GET site by path 1 · GET site drives 1 · PUT file content (upload) 1 (before: GET file content (download) 7.95 · GET folder children 2 · GET item by path 2 · GET site by path 2 · GET site drives 2 · PUT file content (upload) 1)

</details>

### Close loop on Graph — one job, step by step

| Scenario | DB ops before | DB ops after | SQL (est.) before | SQL (est.) after | Graph calls before | Graph calls after | Δ Graph |
|---|---:|---:|---:|---:|---:|---:|---:|
| agent run · find the Compliance library (complianceDrive) | 0 | 0 | 0 | 0 | 2 | 2 | = |
| agent run · find the Compliance library again (second deliverable / next run) | 0 | 0 | 0 | 0 | 2 | 0 | -100% |
| agent run · upload one Working deliverable (putNew) | 0 | 0 | 0 | 0 | 2 | 2 | = |
| approve · copy Working → Final (copyVersioned) | 0 | 0 | 0 | 0 | 3 | 3 | = |
| close gate · verify the Final file (closeJob) | 0 | 0 | 0 | 0 | 2 | 1 | -50% |
| reconciler · re-check the DONE file (verify, a later cron run) | 0 | 0 | 0 | 0 | 2 | 1 | -50% |

<details><summary>Operation breakdown</summary>

- **agent run · find the Compliance library (complianceDrive)** — ; Graph: GET site by path 1 · GET site drives 1 (0.2 KiB received from Graph)
  - before: ; Graph: GET site by path 1 · GET site drives 1
- **agent run · find the Compliance library again (second deliverable / next run)** — ; Graph:  (0 KiB received from Graph)
  - before: ; Graph: GET site by path 1 · GET site drives 1
- **agent run · upload one Working deliverable (putNew)** — ; Graph: GET folder children 1 · PUT file content (upload) 1 (0.2 KiB received from Graph)
  - before: ; Graph: GET item by path 1 · PUT file content (upload) 1
- **approve · copy Working → Final (copyVersioned)** — ; Graph: GET file content (download) 1 · GET folder children 1 · PUT file content (upload) 1 (47.1 KiB received from Graph)
  - before: ; Graph: GET file content (download) 1 · GET item by path 1 · PUT file content (upload) 1
- **close gate · verify the Final file (closeJob)** — ; Graph: GET item by path 1 (0.2 KiB received from Graph)
  - before: ; Graph: GET item by path 1 · GET file content (download) 1
- **reconciler · re-check the DONE file (verify, a later cron run)** — ; Graph: GET item by path 1 (0.2 KiB received from Graph)
  - before: ; Graph: GET item by path 1 · GET file content (download) 1

</details>

### Cron: close-loop reconciler (200 clients, 2,000 jobs: 30 open close-loop jobs, 160 DONE in the last 30 days)

| Scenario | DB ops before | DB ops after | SQL (est.) before | SQL (est.) after | Graph calls before | Graph calls after | Δ Graph |
|---|---:|---:|---:|---:|---:|---:|---:|
| reconciler · run 1 · files already in SharePoint (first run after a restart) | 707 | 360 | 831 | 484 | 400 | 390 | -2% |
| reconciler · run 2 (30 min later) · files already in SharePoint (first run after a restart) | 515 | 168 | 559 | 212 | 380 | 190 | -50% |
| reconciler · run 1 · files written by this process (copyToFinal) | 707 | 360 | 831 | 484 | 400 | 200 | -50% |
| reconciler · run 2 (30 min later) · files written by this process (copyToFinal) | 515 | 168 | 559 | 212 | 380 | 190 | -50% |

<details><summary>Operation breakdown</summary>

- **reconciler · run 1 · files already in SharePoint (first run after a restart)** — $transaction 20 · auditEvent.create 32 · coachEvent.create 53 · deliverable.findMany 41 · deliverable.updateMany 10 · jobTask.findFirst 50 · jobTask.findMany 2 · jobTask.findUnique 20 · jobTask.updateMany 20 · jobTaskEvent.create 20 · jobTaskEvent.findMany 31 · turiaSync.findMany 50 · user.findUnique 11; Graph: GET item by path 200 · GET file content (download) 190 (open 30, closed 10, DONE re-checked 170, alerts 0, reminders 20, escalations 33)
  - before: $transaction 20 · auditEvent.create 32 · coachEvent.create 53 · deliverable.findMany 210 · deliverable.updateMany 10 · jobTask.findFirst 50 · jobTask.findMany 2 · jobTask.findUnique 20 · jobTask.updateMany 20 · jobTaskEvent.create 20 · jobTaskEvent.findMany 200 · turiaSync.findMany 50 · user.findUnique 20; Graph: GET item by path 200 · GET file content (download) 200
- **reconciler · run 2 (30 min later) · files already in SharePoint (first run after a restart)** — auditEvent.create 20 · coachEvent.create 53 · deliverable.findMany 21 · jobTask.findFirst 20 · jobTask.findMany 2 · jobTaskEvent.findMany 21 · turiaSync.findMany 20 · user.findUnique 11; Graph: GET item by path 190 (open 20, closed 0, DONE re-checked 170, alerts 0, reminders 0, escalations 0)
  - before: auditEvent.create 20 · coachEvent.create 53 · deliverable.findMany 190 · jobTask.findFirst 20 · jobTask.findMany 2 · jobTaskEvent.findMany 190 · turiaSync.findMany 20 · user.findUnique 20; Graph: GET item by path 190 · GET file content (download) 190
- **reconciler · run 1 · files written by this process (copyToFinal)** — $transaction 20 · auditEvent.create 32 · coachEvent.create 53 · deliverable.findMany 41 · deliverable.updateMany 10 · jobTask.findFirst 50 · jobTask.findMany 2 · jobTask.findUnique 20 · jobTask.updateMany 20 · jobTaskEvent.create 20 · jobTaskEvent.findMany 31 · turiaSync.findMany 50 · user.findUnique 11; Graph: GET item by path 200 (open 30, closed 10, DONE re-checked 170, alerts 0, reminders 20, escalations 33)
  - before: $transaction 20 · auditEvent.create 32 · coachEvent.create 53 · deliverable.findMany 210 · deliverable.updateMany 10 · jobTask.findFirst 50 · jobTask.findMany 2 · jobTask.findUnique 20 · jobTask.updateMany 20 · jobTaskEvent.create 20 · jobTaskEvent.findMany 200 · turiaSync.findMany 50 · user.findUnique 20; Graph: GET item by path 200 · GET file content (download) 200
- **reconciler · run 2 (30 min later) · files written by this process (copyToFinal)** — auditEvent.create 20 · coachEvent.create 53 · deliverable.findMany 21 · jobTask.findFirst 20 · jobTask.findMany 2 · jobTaskEvent.findMany 21 · turiaSync.findMany 20 · user.findUnique 11; Graph: GET item by path 190 (open 20, closed 0, DONE re-checked 170, alerts 0, reminders 0, escalations 0)
  - before: auditEvent.create 20 · coachEvent.create 53 · deliverable.findMany 190 · jobTask.findFirst 20 · jobTask.findMany 2 · jobTaskEvent.findMany 190 · turiaSync.findMany 20 · user.findUnique 20; Graph: GET item by path 190 · GET file content (download) 190

</details>

### Cron: coach jobs (same firm)

| Scenario | Prisma ops before | Prisma ops after | SQL (est.) before | SQL (est.) after | Δ |
|---|---:|---:|---:|---:|---:|
| coach · morning board (09:00, once a working day) | 19 | 19 | 22 | 22 | = |
| coach · reminders (every 30 min, first run of the day) | 167 | 168 | 170 | 171 | +1% |
| coach · reminders (every 30 min, a later run: nothing new) | 93 | 4 | 96 | 7 | -96% |
| coach · weekly summary (Friday 16:00) | 15 | 15 | 16 | 16 | = |

<details><summary>Operation breakdown</summary>

- **coach · morning board (09:00, once a working day)** — auditEvent.create 1 · coachEvent.createMany 15 · coachPreference.findMany 1 · jobTask.findMany 1 · user.findMany 1
  - before: auditEvent.create 1 · coachEvent.createMany 15 · coachPreference.findMany 1 · jobTask.findMany 1 · user.findMany 1
- **coach · reminders (every 30 min, first run of the day)** — auditEvent.create 74 · coachEvent.createMany 90 · coachEvent.findMany 1 · jobTask.findMany 1 · user.findMany 2
  - before: auditEvent.create 74 · coachEvent.createMany 90 · jobTask.findMany 1 · user.findMany 2
- **coach · reminders (every 30 min, a later run: nothing new)** — coachEvent.findMany 1 · jobTask.findMany 1 · user.findMany 2
  - before: coachEvent.createMany 90 · jobTask.findMany 1 · user.findMany 2
- **coach · weekly summary (Friday 16:00)** — auditEvent.create 1 · coachEvent.createMany 11 · jobTask.findMany 2 · user.findMany 1
  - before: auditEvent.create 1 · coachEvent.createMany 11 · jobTask.findMany 2 · user.findMany 1

</details>

### Cron: retention (daily)

| Scenario | Prisma ops before | Prisma ops after | SQL (est.) before | SQL (est.) after | Δ |
|---|---:|---:|---:|---:|---:|
| retention · daily run | 305 | 309 | 305 | 309 | +1% |

<details><summary>Operation breakdown</summary>

- **retention · daily run** — activityHeartbeat.deleteMany 1 · agentRun.updateMany 1 · auditEvent.create 301 · auditEvent.findFirst 1 · auditEvent.findMany 2 · modelCall.findMany 2 · onboardingRun.updateMany 1 (2,700 runs, 57,600 heartbeats (8 days), 300 escalated model calls in the 7-day window, none audited yet)
  - before: activityHeartbeat.deleteMany 1 · agentRun.updateMany 1 · auditEvent.create 301 · auditEvent.findMany 1 · modelCall.findMany 1

</details>

### Pages and views — Prisma operations per render (firm-sized database)

| Scenario | Prisma ops before | Prisma ops after | SQL (est.) before | SQL (est.) after | Δ |
|---|---:|---:|---:|---:|---:|
| /agents · agents list (listRuns, partner) | 1 | 1 | 4 | 4 | = |
| /agents · Waiting for you (listMyJobs, staff) | 1 | 1 | 5 | 5 | = |
| /agents/[agent]/runs/[id] · run review (loadRunReview) | 3 | 4 | 8 | 9 | +33% |
| /focus · next task (getNextTaskView, staff) | 2 | 3 | 7 | 8 | +50% |
| /admin/firm-os/mistakes · mistakes (listMistakes, 30 rows) | 31 | 7 | 31 | 7 | -77% |
| /coach · coach board (loadCoachPage, manager) | 7 | 7 | 10 | 10 | = |
| /search · text query (manager) | 18 | 18 | 53 | 53 | = |
| /search · identifier query (PAN, manager) | 3 | 3 | 4 | 4 | = |

<details><summary>Operation breakdown</summary>

- **/agents · agents list (listRuns, partner)** — agentRun.findMany 1
  - before: agentRun.findMany 1
- **/agents · Waiting for you (listMyJobs, staff)** — jobTask.findMany 1
  - before: jobTask.findMany 1
- **/agents/[agent]/runs/[id] · run review (loadRunReview)** — agentRun.findFirst 1 · agentRun.findUnique 1 · auditEvent.create 1 · auditEvent.findMany 1
  - before: agentRun.findFirst 1 · agentRun.findUnique 1 · auditEvent.findMany 1
- **/focus · next task (getNextTaskView, staff)** — jobTask.findMany 1 · sopPack.findFirst 2
  - before: jobTask.findMany 1 · sopPack.findFirst 1
- **/admin/firm-os/mistakes · mistakes (listMistakes, 30 rows)** — mistakeLog.findMany 1 · sopPack.findFirst 6
  - before: mistakeLog.findMany 1 · sopPack.findFirst 30
- **/coach · coach board (loadCoachPage, manager)** — agentRun.findMany 1 · coachEvent.findFirst 1 · coachEvent.findMany 2 · coachPreference.findUnique 1 · jobTask.findMany 1 · user.findMany 1
  - before: agentRun.findMany 1 · coachEvent.findFirst 1 · coachEvent.findMany 2 · coachPreference.findUnique 1 · jobTask.findMany 1 · user.findMany 1
- **/search · text query (manager)** — client.findMany 2 · jobTask.findMany 2 · agentRun.findMany 2 · deliverable.findMany 2 · onboardingRun.findMany 2 · job.findMany 2 · clientDocument.findMany 2 · firmClient.findMany 2 · commsDraft.findMany 2
  - before: client.findMany 2 · jobTask.findMany 2 · agentRun.findMany 2 · deliverable.findMany 2 · onboardingRun.findMany 2 · job.findMany 2 · clientDocument.findMany 2 · firmClient.findMany 2 · commsDraft.findMany 2
- **/search · identifier query (PAN, manager)** — client.findMany 1 · onboardingRun.findMany 1 · auditEvent.create 1
  - before: client.findMany 1 · onboardingRun.findMany 1 · auditEvent.create 1

</details>

### Storage — bytes per row and one-year growth

| Table | Sample rows | Heap B/row | Index B/row | Rows / year | MiB / year | Note | Basis |
|---|---:|---:|---:|---:|---:|---|---|
| AgentRun | 136 | 1,095 | 114 | 2,751 | 3.2 | inputs Json adds ~6067 B/run but is nulled after 30 days: ~1.3 MiB live at any time | 2751 runs (agent jobs × 1.5) |
| ChecklistResult | 2,781 | 191 | 70 | 62,750 | 15.6 | grows every year (kept) | measured rows per run × runs |
| Deliverable | 294 | 293 | 56 | 15,003 | 5 | grows every year (kept) | Working rows per run × runs + one Final set per job |
| ModelCall | 173 | 295 | 142 | 4,548 | 1.9 | grows every year (kept) | measured model calls per run × runs (first runs; re-runs on unchanged inputs add none with the response cache) |
| AuditEvent | 136 | 798 | 163 | 17,502 | 16 | grows every year (kept) | 2 per run (guardrail-run, agent-run) + 6 per job (transitions, close, comments) |
| AuditEvent (automated close-refused) | 1 | 264 | 168 | 1,20,000 | 49.4 | grows every year (kept); proposal P4c | reconciler: 20 close-refused per run (held CLOSING jobs) × 20 runs × 300 days |
| AuditEvent (coach crons) | 1 | 216 | 152 | 22,500 | 7.9 | grows every year (kept) | coach: 75 per day (overdue escalations, board, summary) × 300 days |
| JobTaskEvent | 409 | 108 | 56 | 20,000 | 3.1 | grows every year (kept) | 10 transitions per job; the DONE event carries the gate evidence JSON (~695 B) |
| CoachEvent | 116 | 569 | 133 | 32,160 | 21.5 | grows every year (no retention yet) | 107 per working day (simulated morning board + reminders/escalations + weekly summary) × 300 |
| ActivityHeartbeat | 1 | 72 | 92 | 21,60,000 | 337.8 | deleted after 7 days: ~7.9 MiB live at any time | 16 people × 450/day × 300 days written |

Kept growth (all but heartbeats): **~123.6 MiB a year** before TOAST compression.

Assumptions:

- 2,000 JobTasks a year for ~200 clients; agent jobs: gst 1000, tax 333, roc 167, books 167, audit 167 (TDS has no agent yet).
- 1.5 agent runs per agent job (one re-run in two).
- 16 staff, 300 working days, 450 heartbeats per person per day (7.5 active hours, ≤ 1 a minute) when break nudges are on.
- Bytes per row: Postgres heap tuple (28 B header, 8-byte alignment) + one entry per index (8 B + keys + 4 B line pointer); text = length + 1–4 B, jsonb ≈ 1.15 × JSON text, cuid ids 25 B. TOAST compression of large Json is not counted (upper bound).
- Rows are the ones the fixture runs actually wrote (agents) and the coach simulation wrote (CoachEvent).
<!-- efficiency:data:end -->

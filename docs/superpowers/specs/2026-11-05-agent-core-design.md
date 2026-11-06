# Firm OS agent core — Design

Date: 2026-11-05
Status: implemented (Phase 3 task 6, Phase 4 tasks 2–3 core); runner, mistakes and review UI are later tasks

## Goal

Pure, deterministic building blocks that every task agent (GST, ROC, Tax, Books, Audit) and the
onboarding saga share: the JobTask state machine, the checklist engine, deliverable templates and
the statutory calendar. No Prisma, fetch or clock inside the pure modules; the one database
service takes an injected Prisma-like client. Nothing here imports `src/lib/ai` or
`src/lib/integrations`: the model call (`llmCheck`) is injected.

## Files (`src/lib/agents/core/`)

| File | Role |
|---|---|
| `state.ts` | JobTask transition table, role rules per edge, CloseGateToken |
| `state-db.ts` | `transitionJobTask(db, id, to, actor, opts)` — one transaction, optimistic concurrency, JobTaskEvent |
| `checklist.ts` | Rules as data, registry of deterministic bodies, LLM verdict validation, summary |
| `format.ts` | `formatInr` (1,23,456.00), Indian-grouping XLSX number format, DD MMM YYYY, IST times |
| `templates.ts` | `buildWorkbook` (exceljs) and `buildDocx` (docx) with the fixed header block |
| `calendar.ts` | Generic due-date engine over Zod-validated rules |
| `calendar-defaults.ts` | Default rules (seed for `SopPack.calendar`) |
| `index.ts` | Barrel; explicit names only |

## JobTask state machine

| From | To | Edge | Who / precondition |
|---|---|---|---|
| DRAFT | ASSIGNED | assign | manager or partner; assignee set |
| ASSIGNED | IN_PREP | start-prep | assignee, manager, partner, or the agent runner |
| IN_PREP | AGENT_DONE | agent-finished | agent run only |
| IN_PREP | IN_REVIEW | submit-manual-prep | assignee, manager, partner (work without an agent) |
| AGENT_DONE | IN_PREP | rerun-agent | assignee, manager, partner; note |
| AGENT_DONE | IN_REVIEW | submit-for-review | assignee, manager, partner |
| IN_REVIEW | IN_PREP | request-changes | the job's reviewer, manager, partner; note |
| IN_REVIEW | APPROVED | approve | reviewer, manager, partner; not the assignee unless partner; block failures on the latest run → partner + note only |
| APPROVED | FILED_BY_HUMAN | confirm-filed | a person with staff/manager/partner role; ack ref required for GST, ROC, IncomeTax, TDS (stored, never verified) |
| FILED_BY_HUMAN | CLOSING | start-closing | close-loop hook (system) or staff |
| FILED_BY_HUMAN | APPROVED | retract-filing | manager or partner; note |
| CLOSING | APPROVED | retract-filing | manager or partner; note |
| CLOSING | DONE | close | CloseGateToken only |

Decisions:

- **No CLOSING → FILED_BY_HUMAN.** A wrong ack ref or a filing confirmed in error is undone by
  retracting to APPROVED (manager/partner, with a note) and confirming again. The event history then
  shows both refs; `filedAt`/`filedById`/`ackRef` are cleared on retraction and the old ref is
  written into the event note.
- **IN_PREP → IN_REVIEW exists** so services without an agent (or an agent outage) can still be
  prepared by hand and reviewed. AGENT_DONE stays agent-only.
- **Nothing leaves DONE.** The reconciler alerts; it does not reopen (ADR-005).
- **Admin** (IT role) takes no job edges.
- Actors are `human {userId, roles}`, `agent {runId}` or `system {name}`; JobTaskEvent.actorId stores
  the user id, `agent:<runId>` or `system:<name>`.
- `state-db` counts block failures on the latest AgentRun inside the transaction, so a caller cannot
  understate them.
- Optimistic concurrency: the caller passes `expectedState`; the row is re-read in the transaction and
  updated with `updateMany where {id, state, updatedAt}`; `count !== 1` → CONFLICT, nothing written.

### How the DONE gate token works

- `CloseGateToken` is a branded type (a `unique symbol` brand that does not exist at runtime) over a
  frozen object `{ jobTaskId, mintedAt, expiresAt, evidence }`. Every real token is recorded in a
  module-private `WeakMap`; a look-alike object is "FORGED".
- The only way to mint is the closure returned by `registerCloseGate()` in `state.ts`. It can be
  called **once per module instance** (a second call throws). Phase 8's
  `src/lib/close-loop/gate.ts` will call it at module top level and keep the minter private:

  ```ts
  import { registerCloseGate } from "@/lib/agents/core/state";
  const mint = registerCloseGate();
  // after re-checking SharePoint + Turia + filing in one transaction:
  const token = mint({ jobTaskId, now, evidence: { deliverableIds, turiaSyncId, filedEventId } });
  await transitionJobTask(tx, jobTaskId, "DONE", { kind: "system", name: "close-gate" }, { expectedState: "CLOSING", gateToken: token, now });
  ```

- `registerCloseGate` is not in the barrel, and a repo-scan test in `state.test.ts` fails if any
  file under `src/` or `scripts/` other than `state.ts`, its tests, and `src/lib/close-loop/gate.ts`
  (+ its test) mentions it.
- A token is bound to one job, valid for 60 s from minting, and single-use (`state-db` consumes it
  inside the DONE transaction). `canTransition` refuses DONE from every state except CLOSING, and
  from CLOSING without a valid token, for every actor including partners.
- Limits: this is an in-process control. Phase 8 still adds the database backstop from ADR-005
  (trigger or Prisma extension rejecting `state = DONE` writes that do not come from the gate), and
  route handlers never accept DONE as a target.

## Checklist engine

- Serialised pack (`SopPack.checklist`): `{ schemaVersion: 1, key, version: "x.y.z", rules: [...] }`;
  rule `{ id, title, severity: block|warn|info, kind: deterministic|llm, check, evidence, failMessage?,
  params?, origin? }`. For deterministic rules `check` is the registry key of the TS body; for LLM
  rules it is the question. `loadRuleSet` fails closed when a deterministic rule has no body.
- Order: all deterministic rules, then LLM rules one at a time (deterministic order of calls).
- LLM verdicts are validated: `{ status, evidence: { quote, location } }` with a non-blank location
  and a quote that occurs in the documents text the rule was given (`llmContext(rule, input)`,
  default the input as JSON; whitespace and case normalised, nothing else), else status `na` +
  flag `llm-evidence-missing`. Throws → `na` + `llm-error`; no `llmCheck` → `na` + `llm-unavailable`.
- Fail-safe for code: a deterministic body that throws, or a missing body at run time, is recorded
  as `fail` with a flag, so a block rule that could not run stops approval.
- Mistakes: `rulesFromMistakeLogs` takes only APPROVED rows with a `promotedToVersion` and a valid
  proposal; results from such rules carry `source: "mistake"`. `withPromotedRule` returns a new pack
  with a minor version bump (the caller writes it as a new SopPack row; nothing is edited in place).
- `summarizeChecklist` gives counts by status, severity and source, `blockingFailures`, `flagged`,
  `hasBlockingFailures`. `toChecklistResultRows` maps to `ChecklistResult` (flags inside evidence JSON).

## Deliverable templates

- Fixed layout on every sheet: row 1 title, row 2 the label "Draft — prepared for human review; not
  for filing", rows 3–9 Client (name + code), Period, Financial year, Prepared by (agent run id),
  Reviewed by (empty until approved), Version, Generated at (IST, `DD MMM YYYY HH:mm IST`); column
  headers on row 11 (frozen), data from row 12. The label is also in the print header, the workbook
  subject and the DOCX page header/footer.
- Column types `text | inr | integer | date | percent`. Dates are written as real dates on the IST
  calendar day (`dd mmm yyyy`). Totals rows are `SUM` formulas carrying the paise-exact TS result.
- `INR_NUMFMT` = `[>=10000000]##\,##\,##\,##0.00;[>=100000]##\,##\,##0.00;##,##0.00`. Spreadsheet
  number formats allow only two conditions, so negatives beyond −1,00,000 and amounts of ₹100 crore
  or more show partial grouping in Excel. `formatInr` (used in DOCX and on screen) is exact.
- Output `{ buffer, sha256, fileName, mimeType, sizeBytes }`; file name
  `{CODE}_{title}_{period}_v{n}.xlsx|docx`. Workbook created/modified are set to `generatedAt`; the
  zip entries use the current time, so identical specs give identical bytes only at the same instant
  (tests pin the clock).

## Statutory calendar

- Rules are data (`CalendarPackSchema`, stored in `SopPack.calendar`): anchor `period-end`
  (+ months, day N clamped to month length, or `last`) or `agm` (+ days, `countAgmDay`), per-period
  overrides, and first-match variants on `qrmp`, `periodKind`, `monthOfQuarter`, `stateGroup`,
  `category`, `period`. A variant can be `notApplicable` with a reason (IFF in the third month).
- Periods follow the JobTask convention: `2026-10`, `Q1`–`Q4` (FY quarters), `H1`/`H2`, `Annual`.
- Internal due = statutory − buffer (pack `bufferDays`, default 3), then back to the previous working
  day (Saturday/Sunday by default, configurable; holiday hook). The statutory date is never moved;
  `statutoryOnNonWorkingDay` reports it.
- Errors are returned, not thrown (`STATE_REQUIRED`, `AGM_DATE_REQUIRED`, `NOT_APPLICABLE`, ...), so
  onboarding can show the reason.

### Assumptions a partner must verify before go-live

1. QRMP GSTR-3B state groups (22nd: 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37;
   24th: 01–21 and 38). Check against the current CBIC notification; code 97
   (Other Territory) is in neither group and returns UNKNOWN_STATE.
2. AGM-relative forms count the AGM day as day 1 (AOC-4 29 Oct, MGT-7 28 Nov, ADT-1 14 Oct for a
   30 Sep AGM), the earlier of the two readings. Flip `countAgmDay` in the pack if the firm prefers
   the General Clauses Act reading (30 Oct / 29 Nov / 15 Oct).
3. ITR dates are the 1961-Act s.139(1) dates (31 Jul / 31 Oct / 30 Nov). The Income-tax Act, 2025
   applies from tax year 2026-27 and later Finance Acts may have moved non-audit business returns;
   confirm before FY 2026-27 jobs are generated.
4. DIR-3 KYC is modelled as annual, 30 September. MCA has amended the KYC frequency; confirm.
5. TDS return forms (24Q/26Q) and advance-tax sections are named as under the 1961 Act; dates and
   form numbers under the 2025 Act rules need confirming.
6. One-off extensions (CBIC/CBDT/MCA circulars) are not in the defaults; publish them as a new
   SopPack version.

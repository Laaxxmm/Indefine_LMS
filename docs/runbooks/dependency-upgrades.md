# Dependency upgrades — audit findings and plan

> **Current state (18 Nov 2026, branch `fix/deps-advisories`):** `npm audit --omit=dev` reports
> **1** advisory (zod, HIGH, mitigated by the body caps); `npm audit` reports 24 vulnerable
> packages from 6 advisories, all dev/test/lint tooling apart from zod. The prisma → deepmerge-ts
> and exceljs → uuid rows below are **fixed** by npm `overrides`. See
> [Re-check, 18 Nov 2026](#re-check-18-nov-2026) for what changed and what remains. Next review:
> **18 Dec 2026**, or sooner on any `npm audit` change (a picomatch release, zod 4 landing).

Security audit finding #32. `npm audit` on 06 Nov 2026 (zod 3.25.76, prisma / @prisma/client
6.19.3, exceljs 4.4.0 → uuid 8.3.2, vitest 3.2.7) reports 18 advisories: 6 in production
dependencies (`npm audit --omit=dev`), the rest in test and lint tooling. Every fix `npm audit`
offers is a **major** upgrade (`npm audit fix --force`). Majors are **not** taken in the security
pass: each one changes behaviour the accuracy gates and the Prisma schema depend on, so each is its
own change with its own checks (below). This page records what is exposed today and why the risk
is accepted until then.

## Production dependencies

| Package (advisory) | Severity | What it is | Reachable here? | Until the upgrade |
|---|---|---|---|---|
| `zod` < 4.6.6 ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)) | HIGH | Validating an oversized constrained collection (e.g. `z.array(x).max(50)` given a huge array) can exhaust memory before the bound is checked | **Was reachable by any signed-in user; mitigated since re-audit NEW-6 (06 Nov 2026).** The first entry here said a body "can no longer be large"; the re-audit showed that was true only for bodies that declare a Content-Length. A chunked body (no length) from a signed-in caller — or anyone with a forged session cookie, which the middleware cannot tell apart — passed the middleware, and every JSON route read it whole with `req.json()` before zod parsed it; `serverActions.bodySizeLimit` was 51 MB on every page. Now: the middleware refuses a body with no length everywhere except the listed upload routes (`src/lib/hardening/body-limits.ts`); every JSON reader counts bytes as they arrive and stops at 1 MB (`src/lib/hardening/json-body.ts`, the statutory relay keeps 24 MB behind its bearer token); server actions are capped at 2 MB. zod never sees more than 1 MB of JSON from a person (24 MB from the relay). | Keep the body limits and the capped readers; a new route reads JSON only through `readJsonCapped` / the http helpers (a test fails on a direct `req.json()` in `src/app`). Do not raise a cap without checking which schema reads it. |
| `prisma` / `@prisma/config` → `deepmerge-ts` < 8 ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)) | HIGH | Stack exhaustion when merging recursive object graphs | **Fixed 18 Nov 2026** by the `@prisma/config → deepmerge-ts ^8.0.2` override (see the 18 Nov re-check). Before that: **CLI only.** `@prisma/config` merges the Prisma configuration when the CLI runs (`prisma generate`, `prisma db push`, `scripts/migrate.mjs` at start-up). Its input is our own config and schema, never request data; the query engine path (`@prisma/client` at run time) does not merge user objects with it. | Nothing to do at run time. Do not load Prisma config from user-supplied files. |
| `exceljs` → `uuid` < 11.1.1 ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) | MODERATE | Missing bounds check in `uuid` v3 / v5 / v6 **when a caller passes its own output buffer** | **Fixed 18 Nov 2026** by the `exceljs → uuid ^11.1.1` override (plan step 4). Before that: **Unreachable.** ExcelJS 4.4.0 calls only `uuid.v4()` with no buffer (conditional-formatting ids in `cf-rule-ext-xform.js`); the app never imports `uuid`. `npm audit`'s "fix" is a *downgrade* to exceljs 3.4.0, which would lose features and change workbook output. | Wait for an exceljs release on uuid ≥ 11.1.1, or pin `uuid` with an npm `overrides` entry once ExcelJS's tests pass with it. |

## Development-only tooling (never shipped, never run on Railway)

| Package | Severity | Note |
|---|---|---|
| `tinypool` ≤ 2.1.1 (via vitest) — GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | CRITICAL | Prototype-pollution gadget in worker options → code execution **inside the test runner**. Needs attacker-controlled objects in our own test process; reachable only by a malicious dependency already running in CI. Fixed by vitest 5. |
| `@vitest/mocker` ≤ 4.1.11 (via vitest) — GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | MODERATE | Path traversal / mock injection in the vitest dev server. We run `vitest run` (no server, no browser mode). Fixed by vitest 5. |
| `glob` 9–14.0.1, `minimatch` 7–11.0.0 (via `test-exclude`, `@typescript-eslint/*`) — GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | MODERATE | **Fixed 18 Nov 2026**: typescript-eslint 8.73.0 (minimatch 11.0.9, in range of `eslint-config-next`) and the `test-exclude → glob ^14.0.6 / minimatch ^11.0.9` override. |
| `picomatch` ≤ 4.0.7 — GHSA-fc5q-39xc-vjpf (new since 06 Nov) | HIGH | ReDoS from a **pattern** with single-branch repeated extglobs. **No fixed version is published** (4.0.7 is the latest). Pulled in by vitest / vite / tinyglobby / fdir, tailwindcss 3 (chokidar, micromatch, fast-glob, sucrase) and the lint stack (typescript-eslint, `eslint-import-resolver-typescript`, `@next/eslint-plugin-next`). The patterns are ours (config globs); none of these run at request time. Next's own vendored copy (`next/dist/compiled/picomatch`) is not seen by `npm audit` and is only used for config patterns (we set no `images.remotePatterns`). See the 18 Nov re-check. |

## Plan

Each step is a separate branch and PR, merged only when **all** of these are green and unchanged:
`npm run lint && npm run typecheck && npm test && npm run verify:firm-os`, the six accuracy gates
(`npm run accuracy`, scoreboard identical to `main` apart from the timestamp), `npx next build`, and
`npm run e2e:db` against a scratch database.

1. **zod 4** (removes the HIGH production advisory). ~85 files import zod; ~70 use APIs that moved
   (`errorMap` → `error`, `.flatten()` / `.format()` → `z.treeifyError` / `z.flattenError`,
   `z.string().email()` → `z.email()`, `.strict()` / `.passthrough()` → `z.strictObject` /
   `z.looseObject`, `z.nativeEnum` → `z.enum`, `ZodSchema` → `ZodType` in `src/lib/agents/http.ts`).
   Route error messages are user-facing (`issues[0].message`): snapshot them before and compare
   after. The agents' model-output schemas (closed outputs, ADR-008) must keep rejecting the same
   inputs — the accuracy "closed outputs" and "scope violations" rows are the check.
   Interim option if zod 4 slips: zod 3.x has no fix; the body limits above remain the mitigation.
2. **vitest 5 + @vitest/coverage-v8 5** (clears every dev-only advisory). Check `vi.mock` hoisting,
   `restoreMocks` semantics and the `testTimeout` setting in `vitest.config.ts`; the suite must report
   the same test count.
3. **Prisma 7** (removes the CLI-only HIGH). Prisma 7 needs a `prisma.config.ts`, the new
   `prisma-client` generator output and a driver adapter (`@prisma/adapter-pg`) instead of
   `datasourceUrl`; `src/lib/prisma.ts` (connection_limit=5 default, global `omit` of
   `Video.sourceText`) and `scripts/migrate.mjs` change, and the `$queryRaw` rate-limit statement must
   be re-run against Postgres (the e2e job). Schema changes stay out of this PR.
4. **exceljs**: when a release depends on uuid ≥ 11.1.1, upgrade within 4.x; otherwise add
   `"overrides": { "uuid": "^11.1.1" }` after confirming ExcelJS only uses `v4()` and the
   workbook/preview tests (`src/lib/hardening/xlsx-guard.test.ts`, deliverable shape checks) pass.
5. **typescript-eslint** with the next `eslint-config-next` that accepts it.

Re-run `npm audit` and `npm audit --omit=dev` after each step and update the tables above.

## Re-check, 06 Nov 2026 (security re-audit NEW-16)

`npm audit` re-run on the re-audit branch, same installed versions (zod 3.25.76, prisma /
@prisma/client 6.19.3, exceljs 4.4.0 → uuid 8.3.2, vitest 3.2.7): **18 advisories** (2 critical,
4 high, 12 moderate), of which **6 in production dependencies** (`npm audit --omit=dev`: 4 high —
`zod`, `prisma`, `@prisma/config`, `deepmerge-ts`; 2 moderate — `exceljs`, `uuid`). No new advisory
since the first audit; every offered fix is still a major (`zod` 4.6.7, `prisma` 7.10.1, `vitest` /
`@vitest/coverage-v8` 5.1.0) or, for exceljs, a downgrade to 3.4.0.

What changed is the exposure, not the list:

- **zod** — the "low" rating above was wrong until today: chunked bodies from signed-in users (or a
  forged session cookie) reached `req.json()` and zod unbounded. Re-audit NEW-6 closed that path
  (no-length bodies refused off the upload routes, 1 MB streaming cap on every JSON reader, 2 MB
  server actions). With NEW-6 in place the residual risk is a 1 MB JSON body from a signed-in user,
  which zod 3 parses well within the 384 MB heap.
- **prisma / @prisma/config / deepmerge-ts** — still CLI-side only (configuration merge when
  `prisma generate` / `db push` / `scripts/migrate.mjs` run); no request data reaches it.
- **exceljs → uuid** — still unreachable (`uuid.v4()` without a buffer). Agent inputs are also now
  capped before ExcelJS or the CSV parser sees them (`xlsx-guard.ts`, `csv-guard.ts`, re-audit NEW-11).

### Decision (06 Nov 2026)

Keep the majors out of the security pass, as decided for finding #32: each is its own branch with
the full bar (lint, typecheck, tests, `verify:firm-os`, all six accuracy gates identical, `next build`,
`e2e:db`). Order stays: **zod 4 first** (the only advisory a person could reach, now mitigated by
NEW-6, so it is scheduled rather than urgent), then vitest 5, Prisma 7, the exceljs / uuid override,
typescript-eslint. Until zod 4 lands, the body caps above are a security control: removing or
raising one needs the same review as a dependency change. Owner: Firm OS lead engineer; review
again on the next `npm audit` change or by 06 Dec 2026, whichever is first.

## Re-check, 18 Nov 2026

`npm audit` on `fix/deps-advisories` (from `main` 3a64c1b, `npm ci` in a clean worktree). The
GitHub push notice of 06 Nov ("2 vulnerabilities on the default branch, 1 high, 1 moderate") is
Dependabot's count, which de-duplicates differently from `npm audit`; it was not re-read here
(no `gh` on the build box). `npm audit` is the source of truth for this page.

| | critical | high | moderate | total packages | advisories |
|---|---|---|---|---|---|
| `npm audit --omit=dev`, before | 0 | 4 | 2 | 6 | 3 (zod, deepmerge-ts, uuid) |
| `npm audit --omit=dev`, after | 0 | 1 | 0 | **1** | 1 (zod) |
| `npm audit`, before | 2 | 19 | 11 | 32 | 10 |
| `npm audit`, after | 2 | 20 | 2 | **24** | 6 (zod, tinypool ×2, @vitest/mocker ×2, picomatch) |

The rise from 18 (06 Nov) to 32 before this branch is one new advisory, picomatch
GHSA-fc5q-39xc-vjpf, which `npm audit` reports on every package that depends on picomatch. The
"after" high count is 19 − 3 + 4: `prisma`, `@prisma/config` and `deepmerge-ts` are fixed, while
four typescript-eslint packages moved from moderate (minimatch, now fixed) to high (picomatch,
not fixable), so their rating went up although their exposure went down.

### What changed

| Change | Kind | Fixes | Why it is safe |
|---|---|---|---|
| `@typescript-eslint/*` 8.59.0 → 8.73.0 (lockfile only; `eslint-config-next` 15.5.15 accepts `^8`) | minor, dev | minimatch GHSA-g3hv-75wg-m249 on the lint path (8.73.0 depends on minimatch ^11.0.1) | Same major; `npm run lint` clean. 8.73.0 was two days old when taken. |
| `overrides."@prisma/config"."deepmerge-ts": "^8.0.2"` (was 7.1.5) | override, transitive of `prisma` | deepmerge-ts GHSA-ggr8-5vv4-36mx (HIGH, production list) | Prisma 6.19.3 is the last 6.x and pins deepmerge-ts 7.1.5; the only fix in Prisma is 7.x (a major, plan step 3). `@prisma/config` calls only `deepmerge` (plain objects from c12 config loading). The 8.0 breaking changes are type renames, `deepmergeInto` no longer mutating inputs and `Map` key merging; none applies. 8.x still ships CJS. Checked: `prisma generate`, `prisma validate`, `next build`. |
| `overrides.exceljs.uuid: "^11.1.1"` (was 8.3.2) | override, transitive of `exceljs` | uuid GHSA-w5hq-g745-h8pq (MODERATE, production list) | exceljs 4.4.0 is the latest release (2023) and the only "fix" offered is a downgrade to 3.4.0. ExcelJS's Node entry (`excel.js` → `lib/`) calls only `require('uuid').v4()` (conditional-formatting ext ids); uuid 11 keeps the CJS build and `v4()`. Checked: a workbook with an extended conditional format writes; the xlsx guard, workbook and agent tests pass. ExcelJS's browser bundle (`dist/`) embeds its own uuid and is not used (no client import of exceljs). |
| `overrides."test-exclude": { glob: "^14.0.6", minimatch: "^11.0.9" }` (was glob 10.5.0, minimatch 9.0.9 / 10.2.6) | override, transitive of `@vitest/coverage-v8` 3.2.7 | glob GHSA-3g3m-2fjr-6pw4 and minimatch GHSA-g3hv-75wg-m249 (dev) | `@vitest/coverage-v8` 3.x has no fixed release (fix is 5.x, plan step 2). test-exclude 7.0.2 uses only `glob()` (promise, named export) and `minimatch()`, both unchanged in glob 14 / minimatch 11. Only `npm run test:coverage` loads it. Checked: `shouldInstrument` and `glob()` give the expected results for the coverage includes. |

`@anthropic-ai/sdk` stays exactly 1.5.0 (`MODEL_SUPPLY_CHAIN`, lockfile test green). Next, React,
Prisma and NextAuth are unchanged.

Rejected: `npm audit fix` (no `--force`) "fixes" the picomatch chain by **downgrading** vite
7.3.7 → 6.2.7, sucrase 3.35.1 → 3.35.0 and `eslint-import-resolver-typescript` 3.10.1 → 3.7.0 to
versions from before they depended on tinyglobby; picomatch stays installed through other paths, so
it removes nothing real and loses patches. A `tinypool` 1 → 2 override under vitest 3 was not
taken: it crosses the pool library's major under a runner built against 1.x, and the fix belongs
to the vitest upgrade.

### What remains and why

| Advisory | Severity | Where | Reachable in production? | Path to a fix |
|---|---|---|---|---|
| zod < 4.6.6 — GHSA-mrhx-c7xc-m3w5 | HIGH | production (`zod` 3.25.76; also an optional peer of `@anthropic-ai/sdk` 1.5.0) | Yes in principle, mitigated: JSON bodies capped at 1 MB (relay 24 MB), no-length bodies refused, server actions 2 MB (re-audit NEW-6). | zod 4 (major; plan step 1). `@anthropic-ai/sdk` 1.5.0 already accepts `zod ^3.25.0 || ^4.0.0` as a peer, so the SDK pin does not block it. |
| tinypool ≤ 2.1.1 — GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | CRITICAL | dev (vitest 3.2.7; `vitest` itself is listed critical through it) | No — test runner only. | vitest 5 (major; plan step 2). |
| @vitest/mocker ≤ 4.1.11 — GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | MODERATE | dev (vitest, `@vitest/coverage-v8`) | No — we run `vitest run`, no dev server or browser mode. | vitest 5 (plan step 2). |
| picomatch ≤ 4.0.7 — GHSA-fc5q-39xc-vjpf | HIGH | dev: vitest / vite, tailwindcss 3 (build-time CSS), typescript-eslint, `eslint-config-next` | No — matched patterns are our own globs at test, lint and build time; nothing reaches it from a request. | **No patched picomatch exists yet.** Take the release when it ships (an override for 2.x / 4.x if parents lag). tailwindcss 4 drops the 2.x chain but is a major and is not justified by this alone. |

### Decision (18 Nov 2026)

Both production advisories that had a fix without a major are fixed (deepmerge-ts, uuid); the
remaining production advisory is zod, still mitigated by the body caps, still plan step 1. Dev-only
advisories wait for vitest 5 and a picomatch release. The plan order above is unchanged; step 4
(exceljs / uuid) is done. Remove the three overrides when their parents ship fixes: deepmerge-ts with
Prisma 7, test-exclude with `@vitest/coverage-v8` 5, uuid with an exceljs release on uuid ≥ 11.1.1.
Owner: Firm OS lead engineer; review again on the next `npm audit` change or by **18 Dec 2026**,
whichever is first.

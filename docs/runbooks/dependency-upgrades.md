# Dependency upgrades — audit findings and plan

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
| `zod` < 4.6.6 ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)) | HIGH | Validating an oversized constrained collection (e.g. `z.array(x).max(50)` given a huge array) can exhaust memory before the bound is checked | **Low.** zod parses request bodies in the API routes, but a body can no longer be large: `src/middleware.ts` refuses by Content-Length before Next reads it (64 KB anonymous, 1 MB bearer callers, 2 MB signed in; the largest route allowance, 24 MB, is the statutory ingest behind its relay token). zod never sees attacker-sized input on the 384 MB heap. | Keep the body limits (`src/lib/hardening/body-limits.ts`); do not raise a route's limit without checking which schema reads it. |
| `prisma` / `@prisma/config` → `deepmerge-ts` < 8 ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)) | HIGH | Stack exhaustion when merging recursive object graphs | **CLI only.** `@prisma/config` merges the Prisma configuration when the CLI runs (`prisma generate`, `prisma db push`, `scripts/migrate.mjs` at start-up). Its input is our own config and schema, never request data; the query engine path (`@prisma/client` at run time) does not merge user objects with it. | Nothing to do at run time. Do not load Prisma config from user-supplied files. |
| `exceljs` → `uuid` < 11.1.1 ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) | MODERATE | Missing bounds check in `uuid` v3 / v5 / v6 **when a caller passes its own output buffer** | **Unreachable.** ExcelJS 4.4.0 calls only `uuid.v4()` with no buffer (conditional-formatting ids in `cf-rule-ext-xform.js`); the app never imports `uuid`. `npm audit`'s "fix" is a *downgrade* to exceljs 3.4.0, which would lose features and change workbook output. | Wait for an exceljs release on uuid ≥ 11.1.1, or pin `uuid` with an npm `overrides` entry once ExcelJS's tests pass with it. |

## Development-only tooling (never shipped, never run on Railway)

| Package | Severity | Note |
|---|---|---|
| `tinypool` ≤ 2.1.1 (via vitest) — GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | CRITICAL | Prototype-pollution gadget in worker options → code execution **inside the test runner**. Needs attacker-controlled objects in our own test process; reachable only by a malicious dependency already running in CI. Fixed by vitest 5. |
| `@vitest/mocker` ≤ 4.1.11 (via vitest) — GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | MODERATE | Path traversal / mock injection in the vitest dev server. We run `vitest run` (no server, no browser mode). Fixed by vitest 5. |
| `glob` 9–14.0.1, `minimatch` 7–11.0.0 (via `test-exclude`, `@typescript-eslint/*`) — GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | MODERATE | ReDoS / cancellation bypass on glob patterns we write ourselves (coverage includes, lint config). Fixed by vitest 5 / `@vitest/coverage-v8` 5 and a newer `typescript-eslint`. |

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

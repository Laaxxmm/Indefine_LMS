# Firm OS UI — tokens, pieces, decisions

One design system: the LMS theme (`tailwind.config.ts`, violet brand) extended, never a second one.
Class strings live in `src/components/ui.ts`; the React pieces built on them in
`src/components/firm-os/`. The orchestrator's DESIGN section is the bar (8pt grid, card padding 24,
rows 44, content 1280, forms 640, one primary action, JobTask state names on chips, ₹ in Indian
grouping, DD MMM YYYY, IST, calm, no emoji, AA contrast, keyboard reachable).

## Spacing — 8pt grid on Tailwind's 4 px steps

| Token (`ui.ts`) | Value | Where |
|---|---|---|
| `pageGutter` | `px-4 sm:px-8` (16 / 32) | every Firm OS `<main>` and header row |
| `pageMain` | `max-w-[1280px] mx-auto` + gutter + `py-8` | every Firm OS layout |
| `contentWidth` / `formWidth` | 1280 / 640 | page / any form |
| `headerGap` | `mb-6` (24) | page header → content |
| `sectionGap` | `mb-8` (32) | section → section |
| `stack` | `space-y-6` (24) | cards in one column |
| `card` | `p-6` (24) | every card |
| `tr` + `td` / `th` | `h-11` + `py-1.5 px-4` (44) | every table row and head; a 32 px button or 24 px chip fits exactly |
| `btn` | `py-[5px]` + `leading-5` + 1 px border on every variant (32); `btnSm` 24; beside a field `h-10` (40) | buttons — a ghost and a primary side by side are the same height |
| `field` | `py-[9px]` + border, inputs and selects `h-10` (40); textareas keep their rows | text fields, selects |
| nav pill (`firmOsLink`, `areaLink`) | `py-2` + `leading-5` (36) | header nav, tabs |
| `chip` | `py-1` + `leading-4` (24) | status chips |

Between regions only multiples of 8. Inside a dense control (a chip, button, table cell, the gap
between a label and its control) 4 px steps are allowed. Half steps (`*-0.5`, `*-1.5`, `*-2.5`,
`*-3.5`) and 20 / 28 px gaps are off the grid; the sweep rounded them to the nearest grid step
(0.5→1, 1.5→2, 2.5→3, 3.5→4, 5→6). The only half steps left are the control paddings that make a
control land on 24 / 32 / 44.

*Settled by:* the request (DESIGN: 8pt grid, card 24, rows 44, 1280 / 640). Phone gutter 16 rather
than the old 20 (`px-5`), because 20 is off the grid.

## Type — one scale

| Role | Token | Bundle |
|---|---|---|
| Page title | `pageTitle` | display face, extrabold, 28/32 on a phone, 32/40 from 640 px, tracking −0.02em |
| Lead | `lead` | 15/24, ink-mute, max 42rem |
| Eyebrow | `eyebrow` | 11/16, extrabold, uppercase, tracking 0.14em, ink-mute |
| Section title | `h2` = `sectionTitle` | 11/16, extrabold, uppercase, tracking 0.12em, ink-mute, 16 below |
| Body, buttons, table cells | `body`, `btn`, `table` | 13/20 |
| Label | `labelText` | 12/16 bold ink-soft |
| Hint, caption, meta | `hintText`, `caption` | 12/16 ink-mute |
| Error | `errorText` | 13/20 rose-700 |
| Card title | `cardTitle` | display face, bold, 20/28 (the client named in the onboarding plan) |
| Figure | `figure` | display face, 28/32, extrabold, tabular |
| Numbers | `numeric` | `tabular-nums` on every amount, date, duration and count column |

The pages had nine sizes between 9.5 and 15 px (13 ×104, 13.5 ×54, 14 ×50, 12 ×45, 11.5 ×32,
12.5 ×25, 11 ×17, 15 ×9, 10.5 ×5, 9.5 ×2). Neighbours half a pixel apart read as the same size, so
each pair collapsed onto its majority: 13.5→13, 12.5→12, 11.5→12, 10.5→11, 9.5→11. Page titles
were 30 (Firm OS) and 32 (admin); one title for both, on the 8pt line grid (32/40).

*Settled by:* the majority per role (counts above), then the 8pt grid for line heights.

## Colour per role — AA on every surface the app uses

Contrast measured with the WCAG formula against white (card), #f5f5fb (page), #f1f0f7 (muted) and
#eeebff (brand-50, the active nav and brand chips).

| Role | Classes | Ratio (worst surface) |
|---|---|---|
| Primary action | `btnPrimary`: white on brand-500 | 5.8:1 |
| Secondary | `btnGhost`: ink-soft on card, border | 9.6:1 |
| Warn | `btnWarn`, `Alert tone="warning"`, chip `warning`: amber-800 on amber-50 | 6.8:1 |
| Danger | `btnDanger`, `Alert tone="error"`, chip `danger`: rose-700 on rose-50 | 5.7:1 |
| Success | `btnSuccess`, `Alert tone="success"`, chip `success`: emerald-800 on emerald-50 | 6.8:1+ |
| Info | `Alert tone="info"`, chip `info`: sky-800 on sky-50 | 6.9:1+ |
| Body text | ink | 15.5:1 |
| Secondary text | ink-soft | 9.6:1 |
| Muted text | ink-mute **#67657d** (was #6c6a82) | 4.8:1 (brand-50); 5.6:1 on white |
| "Faint" text | `text-ink-faint` now renders **#6c6a82** (was #b7b5c6) | 4.6:1 (muted); 5.2:1 on white |
| Error text | `errorText` rose-700 (was red-600) | 5.6:1 (red-600 was 4.4:1 on the page tint) |

* `ink-faint` was #b7b5c6 — 2.0:1 on white — and is written 335 times as text across 88 files
  (most of them LMS). The token keeps #b7b5c6 for fills, borders and disabled backgrounds; only
  its text colour (`theme.extend.textColor`) moves to #6c6a82. That fixes every page at once
  without editing files other work owns. New code writes `text-ink-mute`.
* `ink-mute` darkened from #6c6a82 (4.47:1 on brand-50, a fail on the active nav and brand chips)
  to #67657d. The difference is not visible beside the old value.
* The shared `h2` in `ui.ts` uses ink-mute explicitly (it was the ink-faint source on LMS panels).

*Settled by:* the request (AA, Lighthouse a11y ≥ 95); token over sweep because a token reaches the
files other agents are editing without touching them.

## Shared pieces (`src/components/firm-os`)

| Piece | Replaces |
|---|---|
| `PageHeader` (back link, eyebrow, title, lead, meta, one action slot) | hand-written header blocks on every page; the admin pages' own header (32 px, "← Admin" pill) |
| `Card`, `Section`, `SectionTitle` | `card` + `<h2 className={sectionTitle}>` pairs; local `h2` / `sectionTitle` copies (OnboardPanel, CorrectionHistory) |
| `Chip`, `StateChip`, `RunStatusChip`, `PartnerChip` | `StateChip` from `app/agents/parts`, the hand-toned chips on privacy, breaches, mistakes, onboarding steps (9.5 px rounded-md) |
| `Alert` (error / warning / info / success; errors `role="alert"`) | the rose / amber / sky boxes written by hand in 15+ places |
| `EmptyState` | `parts.EmptyState` (p-12, rounded-[20px]) |
| `DataTable` (caption, `th scope="col"`, its own sideways scroll in a keyboard-focusable region named by the caption, 44 px rows, `sticky` option) | `tableWrap` + `<table>` + `<thead>` written per page |
| `FormField` + `describedBy()` (label, hint, error `role="alert"`, ids tied) | label / hint / error triples written per form |
| `Button` (variants from `ui.ts`, `busy` → spinner + disabled + `aria-busy`), `buttonClass()` | `${btnX} ${focusRing} inline-flex items-center gap-1.5` + `{busy && <Loader2 …/>}` per button; the comms pill buttons |
| `ConfirmStep` / `ConfirmPanel` | the confirm groups written per screen (privacy, breaches, spot checks, companion, mistakes) |

The focus ring is part of `btn`, `field` and `linkText`; `focusRing` has one definition (`ui.ts`),
and the copies in FirmOsHeader, DraftForm, DraftActions, CorrectionHistory and OnboardPanel are gone.
The LMS areas (`/clients`, `/work`, `/tools`) share `src/components/AreaHeader.tsx`, built like the
Firm OS header (wraps on a phone, NavLink marks the current section). Filter and search forms use a
ghost button (40 px beside the 40 px field), so the page's one primary stays the page's action.

*Settled by:* the request named the pieces and where they go; `ui.ts` was already the shared layer
(imported by 45 files), so the strings went there and the components on top.

## Conventions every page follows

* **One primary action** per screen, filled brand (`btnPrimary` / `Button variant="primary"`); the
  rest ghost or a tone. Labels verb first, sentence case ("Run agent", "Approve pack", "New draft").
* **Irreversible actions** go through `ConfirmStep`: first click says what happens, then Cancel /
  Confirm.
* **Messages** go through `Alert`. Their wording is owned by the plain-language error sweep; this
  pass changed only how they are shown.
* **Status**: JobTask states by their exact names on `StateChip`.
* **Dates**: `formatDate` / `formatDateTimeIst` (`src/lib/agents/core/format.ts`) on Firm OS;
  `istLabel` / `formatIst` (`src/lib/ist.ts`) on LMS pages. Both take short months from
  `SHORT_MONTHS` — "Sep", never en-IN's "Sept" — and IST calendar days.
* **Amounts**: `formatInr` (Indian grouping, ₹) with tabular numerals.
* **No emoji, no gamification** on Firm OS pages. (LMS pages keep theirs — an owner decision; the
  list is in docs/qa/ui-checklist.md.)

## How it is checked

* Render tests: `tests/unit/firm-os-components.test.tsx` (variants, busy state, roles, aria wiring),
  `tests/unit/area-header.test.tsx`, `tests/unit/ist-display.test.ts`, and the route render tests.
* Visual: `npx vitest run --config tests/regression/visual.vitest.config.ts` renders every page in
  docs/qa/ui-checklist.md; `node tests/regression/visual-check.mjs` measures each at 390 / 1280 / 1440
  (overflow, row / control heights, card padding, focus ring on every Tab stop, primaries, "Sept", axe-core
  WCAG A/AA). Results are in docs/qa/ui-checklist.md.

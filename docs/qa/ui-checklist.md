# Firm OS — UI screenshot checklist (Phase 12 §5)

Fill this in **on staging**, signed in as the person named in the "As" column, after Phases 9–11 are
merged. One row per page and width. A cell is ✅ (meets the bar), ❌ (fails — note what in *Notes*),
or n/a. The page passes when every cell in its rows is ✅ or n/a. Attach the screenshot file name in
*Shot* (save under `test-results/ui-shots/<slug>-<width>.png`; not committed).

The bar comes from the orchestrator spec, section DESIGN:

| Check | What "pass" means | How to check |
|---|---|---|
| **8pt grid** | Spacing, padding and gaps are multiples of 8 px (4 px allowed inside dense controls); card padding 24; table rows 44 px; content max width 1280 (forms 640). | DevTools → Elements → Computed (padding/margin/gap). Tailwind steps: `p-6` = 24, `gap-2` = 8, `py-3` = 12 (dense controls only). Row height: select a `<tr>`, read the box model. |
| **Alignment** | Headings, cards, tables and the review bar share one left edge per column; numbers right-aligned with tabular numerals; chips vertically centred. | Visual, with DevTools grid / flex overlay on. |
| **No overflow** | No page-level horizontal scroll at that width; nothing clipped; long names and refs wrap. Tables may scroll inside their own container. | Console: `document.documentElement.scrollWidth <= window.innerWidth` → `true`. |
| **Focus states** | Every interactive element is reachable with Tab in a sensible order and shows a visible focus ring (`focus-visible:ring-2 ring-brand-500`). No keyboard trap; dialogs / confirm steps return focus. | Tab through the page from the address bar; Shift+Tab back. |
| **Lighthouse a11y ≥ 95** | Accessibility score ≥ 95 (contrast AA, labels, roles, names). | Chrome DevTools → Lighthouse → Accessibility only → Desktop (1280/1440) and Mobile (390), while signed in. Record the score. |
| **One primary action** | Exactly one primary (filled) button visible for the person's current step. | Visual. |
| **Firm OS conventions** | Status chips use the JobTask state names (DRAFT … DONE); ₹ amounts in Indian grouping (1,23,456.00); dates `DD MMM YYYY` (Sep, not Sept); times IST; no emoji, no gamification. | Visual. |
| **No portal / send** | No button or link submits to a government portal or sends anything to a client (Outlook *draft* only). | Visual + `Ctrl+F` "submit", "send", "file". |

Widths: **1280** and **1440** (desktop, Lighthouse "Desktop"), **390** (phone, Lighthouse "Mobile";
DevTools device toolbar → 390 × 844).

Before staging, take a first look locally: `npx vitest run --config tests/regression/visual.vitest.config.ts`
then open `test-results/visual/index.html` (each page as server-rendered HTML with the compiled
Tailwind CSS, viewable at 390 / 1280 / 1440). That catches layout and overflow problems early; it
cannot run client interactions, focus order or Lighthouse — those are only checked on staging.

## Pages

Phase column: pages marked 9 / 10 / 11 exist only after that phase is merged.

| # | Page | URL (staging) | As | Phase |
|---|---|---|---|---|
| 1 | Onboard (sentence → questions → plan → progress + Turia checklists) | `/onboard` | partner | 3 |
| 2 | Agents list ("Waiting for you" + runs) | `/agents` | staff (assignee) and partner | 4 |
| 3 | Agent page (jobs + Run agent) | `/agents/gst` (and roc, tax, books, audit) | staff (assignee) | 4–7 |
| 4 | Run review (checklist left, preview right, review bar) — AGENT_DONE, IN_REVIEW, APPROVED (Mark filed), CLOSING (Record Turia close), DONE | `/agents/gst/runs/<id>` | assignee; reviewer; partner (retract) | 4, 8 |
| 5 | Mistake log (propose / decide) | `/agents/mistakes` | partner (and manager) | 4 |
| 6 | Turia spot checks | `/agents/spot-checks` | partner | 11 |
| 7 | Morning board (page) | `/coach` | staff | 9 |
| 8 | Morning board card + reminders + break nudge on the dashboard | `/dashboard` | staff | 9 |
| 9 | Client comms drafts (list, draft, Copy / Open in Outlook draft) | `/comms` | staff | 10 |
| 10 | Engagement letter — Create Outlook draft (owner decision 2026-11-05) | `/tools/office-tools/engagement-letter` | staff | 10 |
| 11 | Admin — Model usage (cost by day / agent / provider, guardrail drift) | `/admin/firm-os/models` | LMS admin | 2 |
| 12 | Admin — Mistake log (rule diffs) | `/admin/firm-os/mistakes` | LMS admin | 4 |
| 13 | Admin — Cycle time (median / p90, bottleneck) | `/admin/firm-os/cycle-time` | LMS admin | 8 |
| 14 | Client page — Firm OS jobs card (FIRM_OS_CL_PATHS on) | `/clients/<id>` | partner | 1, UI audit |

## Results

Tester: ________________________  Date: ____ ___ 2026  Build / commit: __________  Staging URL: __________________

| # | Width | 8pt grid | Alignment | No overflow | Focus | Lighthouse a11y | One primary | Conventions | No portal / send | Shot | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Onboard | 1280 | | | | | | | | | | |
| 1 Onboard | 1440 | | | | | | | | | | |
| 1 Onboard | 390 | | | | | | | | | | |
| 2 Agents list | 1280 | | | | | | | | | | |
| 2 Agents list | 1440 | | | | | | | | | | |
| 2 Agents list | 390 | | | | | | | | | | |
| 3 Agent page | 1280 | | | | | | | | | | |
| 3 Agent page | 1440 | | | | | | | | | | |
| 3 Agent page | 390 | | | | | | | | | | |
| 4 Run review — AGENT_DONE (assignee) | 1280 | | | | | | | | | | |
| 4 Run review — AGENT_DONE (assignee) | 1440 | | | | | | | | | | |
| 4 Run review — AGENT_DONE (assignee) | 390 | | | | | | | | | | |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 1280 | | | | | | | | | | |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 1440 | | | | | | | | | | |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 390 | | | | | | | | | | |
| 4 Run review — APPROVED (Mark filed form) | 1280 | | | | | | | | | | |
| 4 Run review — APPROVED (Mark filed form) | 390 | | | | | | | | | | |
| 4 Run review — CLOSING (Record Turia close; partner: Retract) | 1280 | | | | | | | | | | |
| 4 Run review — CLOSING (Record Turia close; partner: Retract) | 390 | | | | | | | | | | |
| 4 Run review — DONE (cycle time) | 1280 | | | | | | | | | | |
| 4 Run review — DONE (cycle time) | 390 | | | | | | | | | | |
| 5 Mistake log | 1280 | | | | | | | | | | |
| 5 Mistake log | 1440 | | | | | | | | | | |
| 5 Mistake log | 390 | | | | | | | | | | |
| 6 Spot checks | 1280 | | | | | | | | | | |
| 6 Spot checks | 1440 | | | | | | | | | | |
| 6 Spot checks | 390 | | | | | | | | | | |
| 7 Coach | 1280 | | | | | | | | | | |
| 7 Coach | 1440 | | | | | | | | | | |
| 7 Coach | 390 | | | | | | | | | | |
| 8 Dashboard board card / nudges | 1280 | | | | | | | | | | |
| 8 Dashboard board card / nudges | 1440 | | | | | | | | | | |
| 8 Dashboard board card / nudges | 390 | | | | | | | | | | |
| 9 Comms | 1280 | | | | | | | | | | |
| 9 Comms | 1440 | | | | | | | | | | |
| 9 Comms | 390 | | | | | | | | | | |
| 10 Engagement letter (Outlook draft) | 1280 | | | | | | | | | | |
| 10 Engagement letter (Outlook draft) | 390 | | | | | | | | | | |
| 11 Admin — Model usage | 1280 | | | | | | | | | | |
| 11 Admin — Model usage | 1440 | | | | | | | | | | |
| 11 Admin — Model usage | 390 | | | | | | | | | | |
| 12 Admin — Mistake log | 1280 | | | | | | | | | | |
| 12 Admin — Mistake log | 1440 | | | | | | | | | | |
| 12 Admin — Mistake log | 390 | | | | | | | | | | |
| 13 Admin — Cycle time | 1280 | | | | | | | | | | |
| 13 Admin — Cycle time | 1440 | | | | | | | | | | |
| 13 Admin — Cycle time | 390 | | | | | | | | | | |
| 14 Client page — Firm OS jobs card | 1280 | | | | | | | | | | |
| 14 Client page — Firm OS jobs card | 1440 | | | | | | | | | | |
| 14 Client page — Firm OS jobs card | 390 | | | | | | | | | | |

## Known before the staging pass

From the UI audit (PROGRESS "UI audit", "Known gaps") — check that each is still as recorded:

- Firm OS pages use the LMS violet brand theme (spec: extend the existing theme), not the teal fallback.
- LMS (not Firm OS) pages: `/clients`, `/work`, `/tools` headers do not wrap at 390 px; `ink-faint` text
  ≈ 2:1 contrast across the LMS; dashboard emoji. These are LMS debts, not Firm OS failures — note them
  but do not fail a Firm OS row for them.
- Local visual render (2026-11-06, `tests/regression/visual-render.ts`): all 14 current Firm OS / comparison
  pages render with the compiled CSS, /coach included. /comms and /agents/spot-checks appear automatically after their merges.

Sign-off: UI checklist complete and passing — ________________________ (owner) date ____________

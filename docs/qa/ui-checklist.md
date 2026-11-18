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
| **Same header** | The Firm OS header has the same width, position and labels as on every other Firm OS page, and the page title starts at the same left edge (a page may narrow its content, never the header). From 1024 px: Next task · Agents · My day · Client messages · More · Search · Help · Dashboard on one row; below, logo · Search · Help · Menu. Dashboard bar on one row from 640 px, Home · Menu below. No header nav scrolls sideways. | Switch between pages at the same width: nothing in the header moves. `node tests/regression/visual-check.mjs` prints the header box and title edge per width and fails a page that differs. |
| **Menus** | More / Learn / Firm OS / Menu open with Enter, Space or ArrowDown; arrows move between the links; Escape closes and puts focus back on the button; they close when you Tab away, click outside or open a page. Each place shows only when its module is on and the role allows it. | Keyboard only, then as a person with fewer modules. |
| **Help** | The page has a Help button; it opens a side panel for this page (what it is for, how to use it, the words, if you're stuck, who to ask); Escape and Close shut it, Tab stays inside, focus returns to Help. The words match the page. | Keyboard; read it against the page. |

Widths: **1280** and **1440** (desktop, Lighthouse "Desktop"), **390** (phone, Lighthouse "Mobile";
DevTools device toolbar → 390 × 844).

Before staging, take a first look locally: `npx vitest run --config tests/regression/visual.vitest.config.ts`
then open `test-results/visual/index.html` (each page as server-rendered HTML with the compiled Tailwind CSS,
viewable at 390 / 1280 / 1440), and run `node tests/regression/visual-check.mjs` (installed Chrome via Playwright): it
measures page overflow, row / head / control heights, card padding, the focus ring on every Tab stop, filled primary
buttons, "Sept" / emoji, and runs axe-core (WCAG A/AA) at each width, writing `test-results/visual/check.json`. That
catches layout, overflow, focus and contrast problems early; it cannot sign in, run client steps or run Lighthouse —
those are only checked on staging.

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
| 9 | Client comms drafts — list, new draft form, draft page (Copy / Open in Outlook draft) | `/comms`, `/comms/new?job=<id>`, `/comms/<id>` | staff | 10 |
| 10 | Engagement letter — Create Outlook draft (owner decision 2026-11-05) | `/tools/office-tools/engagement-letter` | staff | 10 |
| 11 | Admin — Model usage (cost by day / agent / provider, guardrail drift) | `/admin/firm-os/models` | LMS admin | 2 |
| 12 | Admin — Mistake log (rule diffs) | `/admin/firm-os/mistakes` | LMS admin | 4 |
| 13 | Admin — Cycle time (median / p90, bottleneck) | `/admin/firm-os/cycle-time` | LMS admin | 8 |
| 14 | Client page — Firm OS jobs card (FIRM_OS_CL_PATHS on) | `/clients/<id>` | partner | 1, UI audit |
| 15 | Job workspace (tabs, next action) | `/workspace/<jobId>` | staff (assignee) | owner request, merged with 10 |
| 16 | Search | `/search` | staff | owner request, merged with 10 |
| 17 | Focus | `/focus` | staff | owner request, merged with 10 |
| 18 | Companion (browser-extension pairing) | `/companion` | staff | owner request, merged with 10 |
| 19 | Admin — Workspace modules | `/admin/firm-os/workspace` | LMS admin | owner request, merged with 10 |
| 20 | Admin — Privacy requests (DPDP rights: access, correction, erasure, nomination) | `/admin/firm-os/privacy`, `/admin/firm-os/privacy/<id>` | LMS admin | DPDP rights, merged 06 Nov |
| 21 | Admin — Breach register | `/admin/firm-os/breaches`, `/admin/firm-os/breaches/<id>` | LMS admin | DPDP rights, merged 06 Nov |

## Results

Local design pass (not the staging pass): design consistency agent, 06 Nov 2026, branch
`worktree-agent-aeb5be4e77051c217` (commits `design: …`), server-rendered pages with the compiled Tailwind CSS
(`tests/regression/visual-render.ts`), measured in Chrome by `tests/regression/visual-check.mjs` at each width and
looked at in the browser pane, screenshots and montages. Staging URL: — (local render). Not covered here, so still for
the staging pass: real sign-in, client-side steps (confirm steps opening, busy states — covered by render tests),
Lighthouse itself.

Legend: **8pt grid** = table rows and heads ≥ 44 px, card padding 24, buttons 32 (24 compact, 36 nav / tab, 40 beside a
field), fields 40, measured. **Alignment** ✅ = looked at by eye at that width; ✅\* = measured only (same layout as the
widths looked at). **Focus** = every element Tab reaches shows the ring (number of stops). **Lighthouse a11y** = axe-core
WCAG 2.0 / 2.1 A + AA violations (axe is the engine Lighthouse's accessibility score is built on; Lighthouse itself is for
staging). **Shot** = `test-results/visual/shots/` (git-ignored).

Summary: 71 rows · 67 pass · 0 fail · 4 n/a (Run review CLOSING and DONE need the close-loop world — covered by
`tests/unit/routes/close-loop-panel.test.ts`). Per width: 1280 → 23 pass, 0 fail, 2 n/a · 1440 → 21 pass, 0 fail ·
390 → 23 pass, 0 fail, 2 n/a.

| # | Width | 8pt grid | Alignment | No overflow | Focus | Lighthouse a11y | One primary | Conventions | No portal / send | Shot | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Onboard | 1280 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 1 Onboard | 1440 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 1 Onboard | 390 | ✅ | ✅ | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 2 Agents list | 1280 | ✅ | ✅ | ✅ | ✅ 11/10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-agents-partner-1280.png |  |
| 2 Agents list | 1440 | ✅ | ✅ | ✅ | ✅ 11/10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-agents-partner-1440.png |  |
| 2 Agents list | 390 | ✅ | ✅ | ✅ | ✅ 11/10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-agents-partner-390.png |  |
| 3 Agent page | 1280 | ✅ | ✅* | ✅ | ✅ 12 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 3 Agent page | 1440 | ✅ | ✅* | ✅ | ✅ 12 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 3 Agent page | 390 | ✅ | ✅ | ✅ | ✅ 12 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 4 Run review — AGENT_DONE (assignee) | 1280 | ✅ | ✅* | ✅ | ✅ 15 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — | Rendered as the assignee's IN_REVIEW view (the seed submits the pack); the AGENT_DONE bar (Submit for review + Re-run with a note) is asserted in tests/unit/routes/agents.test.ts. |
| 4 Run review — AGENT_DONE (assignee) | 1440 | ✅ | ✅* | ✅ | ✅ 15 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 4 Run review — AGENT_DONE (assignee) | 390 | ✅ | ✅* | ✅ | ✅ 15 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 1280 | ✅ | ✅ | ✅ | ✅ 17 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-run-reviewer-1280.png |  |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 1440 | ✅ | ✅ | ✅ | ✅ 17 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-run-reviewer-1440.png |  |
| 4 Run review — IN_REVIEW (reviewer, Approve / Request changes) | 390 | ✅ | ✅ | ✅ | ✅ 17 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-run-reviewer-390.png |  |
| 4 Run review — APPROVED (Mark filed form) | 1280 | ✅ | ✅* | ✅ | ✅ 18/18 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 4 Run review — APPROVED (Mark filed form) | 390 | ✅ | ✅ | ✅ | ✅ 21/21 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 4 Run review — CLOSING (Record Turia close; partner: Retract) | 1280 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | — | Not rendered locally (needs the close-loop world); bar markup asserted in tests/unit/routes/close-loop-panel.test.ts. Same ActionBar / Button / field tokens as APPROVED. |
| 4 Run review — CLOSING (Record Turia close; partner: Retract) | 390 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | — | Not rendered locally (needs the close-loop world); bar markup asserted in tests/unit/routes/close-loop-panel.test.ts. Same ActionBar / Button / field tokens as APPROVED. |
| 4 Run review — DONE (cycle time) | 1280 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | — | Not rendered locally; CloseLoopStatus DONE line asserted in close-loop-panel.test.ts. |
| 4 Run review — DONE (cycle time) | 390 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | — | Not rendered locally; CloseLoopStatus DONE line asserted in close-loop-panel.test.ts. |
| 5 Mistake log | 1280 | ✅ | ✅* | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 5 Mistake log | 1440 | ✅ | ✅* | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 5 Mistake log | 390 | ✅ | ✅ | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 6 Spot checks | 1280 | ✅ | ✅* | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 6 Spot checks | 1440 | ✅ | ✅* | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 6 Spot checks | 390 | ✅ | ✅ | ✅ | ✅ 10 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 7 Coach | 1280 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 7 Coach | 1440 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 7 Coach | 390 | ✅ | ✅ | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 8 Dashboard board card / nudges | 1280 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — | LMS dashboard; the My day card shows only with open Firm OS jobs (none for this session). LMS emoji kept (owner decision). |
| 8 Dashboard board card / nudges | 1440 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 8 Dashboard board card / nudges | 390 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 9 Comms | 1280 | ✅ | ✅ | ✅ | ✅ 5/5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-comms-1280.png | List and new-draft panel rendered; the draft page (/comms/[id]) needs the comms world: asserted in tests/unit/routes/comms.test.ts. |
| 9 Comms | 1440 | ✅ | ✅ | ✅ | ✅ 5/5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-comms-1440.png |  |
| 9 Comms | 390 | ✅ | ✅ | ✅ | ✅ 5/5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-comms-390.png |  |
| 10 Engagement letter (Outlook draft) | 1280 | ✅ | ✅* | ✅ | ✅ 5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 10 Engagement letter (Outlook draft) | 390 | ✅ | ✅* | ✅ | ✅ 5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 11 Admin — Model usage | 1280 | ✅ | ✅ | ✅ | ✅ 21 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-admin-models-1280.png |  |
| 11 Admin — Model usage | 1440 | ✅ | ✅ | ✅ | ✅ 21 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-admin-models-1440.png |  |
| 11 Admin — Model usage | 390 | ✅ | ✅ | ✅ | ✅ 4 stops | ✅ axe 0 | ✅ | ✅ | ✅ | before/after-admin-models-390.png |  |
| 12 Admin — Mistake log | 1280 | ✅ | ✅* | ✅ | ✅ 20 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 12 Admin — Mistake log | 1440 | ✅ | ✅* | ✅ | ✅ 20 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 12 Admin — Mistake log | 390 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 13 Admin — Cycle time | 1280 | ✅ | ✅* | ✅ | ✅ 21 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 13 Admin — Cycle time | 1440 | ✅ | ✅* | ✅ | ✅ 21 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 13 Admin — Cycle time | 390 | ✅ | ✅* | ✅ | ✅ 4 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 14 Client page — Firm OS jobs card | 1280 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — | The Firm OS card meets the bar (44 px rows and head). The page's own LMS Jobs table keeps its compact 33 px head row (LMS look); its controls got labels and the table a focusable scroll region. |
| 14 Client page — Firm OS jobs card | 1440 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 14 Client page — Firm OS jobs card | 390 | ✅ | ✅* | ✅ | ✅ 14 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 15 Job workspace | 1280 | ✅ | ✅* | ✅ | ✅ 9 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 15 Job workspace | 1440 | ✅ | ✅ | ✅ | ✅ 9 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 15 Job workspace | 390 | ✅ | ✅ | ✅ | ✅ 9 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 16 Search | 1280 | ✅ | ✅* | ✅ | ✅ 13 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 16 Search | 1440 | ✅ | ✅* | ✅ | ✅ 13 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 16 Search | 390 | ✅ | ✅ | ✅ | ✅ 13 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 17 Focus | 1280 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 17 Focus | 1440 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 17 Focus | 390 | ✅ | ✅ | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 18 Companion | 1280 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 18 Companion | 1440 | ✅ | ✅* | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 18 Companion | 390 | ✅ | ✅ | ✅ | ✅ 3 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 19 Admin — Workspace modules | 1280 | ✅ | ✅* | ✅ | ✅ 27 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 19 Admin — Workspace modules | 1440 | ✅ | ✅* | ✅ | ✅ 27 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 19 Admin — Workspace modules | 390 | ✅ | ✅ | ✅ | ✅ 15 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 20 Admin — Privacy requests | 1280 | ✅ | ✅* | ✅ | ✅ 22 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — | List rendered; the request page (/admin/firm-os/privacy/[id]) is being changed by the security work and was left to wrapper classes only (shared AdminHeader, chips and ConfirmStep reach it). |
| 20 Admin — Privacy requests | 1440 | ✅ | ✅ | ✅ | ✅ 22 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 20 Admin — Privacy requests | 390 | ✅ | ✅ | ✅ | ✅ 5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |
| 21 Admin — Breach register | 1280 | ✅ | ✅* | ✅ | ✅ 22 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — | Register rendered; the incident page uses the same PageHeader, figure and Button tokens (asserted in src/app/admin/firm-os/privacy/pages.test.tsx). |
| 21 Admin — Breach register | 1440 | ✅ | ✅* | ✅ | ✅ 22 stops | ✅ axe 0 | ✅ | ✅ | ✅ | — |  |
| 21 Admin — Breach register | 390 | ✅ | ✅ | ✅ | ✅ 5 stops | ✅ axe 0 | ✅ | ✅ | ✅ | montage-390-*.png |  |

### Header, menus and help pass (06 Nov 2026)

Owner report from production: `/focus` drew the header in a narrow column (menu cut off, Companion /
Search / Dashboard hidden) while `/agents` used the full width; the menus were long and inconsistent;
no page explained itself. Branch `worktree-agent-aff770eced60ed70b`. The visual render now switches
every module on and keeps the Firm OS switch on while React renders, so the header shows every place
(before, the render's header was empty and could not show the problem).

* **Same header** — 17 Firm OS renders × 3 widths: header box `0+390` / `0+1280` / `80+1280` and title
  edge 16 / 32 / 112 on every one (before: `/focus` 256+768 with its title at 288 at 1280, the workspace
  title at 57). The 6 admin renders share one title edge per width (24 / 280 / 296) in the admin layout.
* **Menus** — keyboard steps checked in Chrome on the built components (open, arrows, wrap, Escape back
  to the button, Tab away, outside click, route change); markup asserted in the header and dashboard tests.
* **Help** — 25 entries (all 22 Firm OS pages, the dashboard, Tools and Clients); panel checked in Chrome
  (focus on Close, Tab trapped, Escape returns focus to Help, route change closes).
* `node tests/regression/visual-check.mjs`: 82 / 84 page × width checks pass, axe 0 on every page; the 2
  fails are the client page's own LMS Jobs table head (33 px) at 1280 and 1440, listed below as an LMS debt.
* Not rendered locally (need records the render world does not have): `/comms/[id]`,
  `/admin/firm-os/privacy/[id]`, `/admin/firm-os/breaches/[id]`. They use the same layouts, so the same
  header and title edge; their help entries are covered by the registry test.

## Known before the staging pass

From the UI audit (PROGRESS "UI audit", "Known gaps") and the design consistency pass (06 Nov 2026,
`docs/design/firm-os-ui.md`):

- Firm OS pages use the LMS violet brand theme (spec: extend the existing theme), not the teal fallback.
- Fixed in the design pass: `/clients`, `/work`, `/tools` headers wrap at 390 px and mark the current section
  (AreaHeader + NavLink); `ink-faint` text is AA (token remapped to #6c6a82, the shared h2 uses ink-mute); "Sept" from
  en-IN in `src/lib/ist.ts` (fixed month list); `/tools` card "Open" text and the client page's unlabelled selects.
- The Clients area bar, the Tools card and Workspace settings call `/onboard` "Onboard client (Firm OS)", beside the LMS "Onboard" (`/clients/new`); the Firm OS header calls it "Onboard client" (owner decision 06 Nov 2026).
- LMS debts left as they are (owner decisions or LMS look, not Firm OS fails): emoji and gamification on
  `/dashboard` (👋 🎉 🔥 ⚡ 🎬 🏅 🚀 📡 💬 ✨ 🕑 💼 ✅), `/` (sign-in), `/leaderboard`, `/recap`, `/team/[userId]`,
  `/initiatives`, `/tools/neo-centra` (+ how-it-works), `/admin/auto-quiz`, `/admin/live`, `/admin/trajectory`;
  the client page's own Jobs table head is 33 px; LMS pages that format dates with en-IN directly
  (`/clients` list, `/tools/sop-builder`, office-tools history, certificate history, `src/lib/client-ops/core.ts`)
  still write "Sept" — they do not go through `src/lib/ist.ts`.
- Local visual render (06 Nov 2026, design pass): 28 renders — every Firm OS page in the list above plus the LMS
  comparison pages — with the master switch on; Run review APPROVED rendered after a real approval of the echo run.

Sign-off: UI checklist complete and passing — ________________________ (owner) date ____________

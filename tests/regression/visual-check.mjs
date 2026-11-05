// Visual check of the rendered pages (NOT run by `npm test`). Run the visual render first, then:
//
//   npx vitest run --config tests/regression/visual.vitest.config.ts
//   node tests/regression/visual-check.mjs            # uses the installed Chrome (Playwright channel "chrome")
//
// For every page in test-results/visual at 390, 1280 and 1440 px it measures what docs/qa/ui-checklist.md
// asks and a static render can show: page-level horizontal overflow, table row heights (44), card
// padding (24), a visible focus indicator on every element Tab reaches, filled primary buttons on
// screen, "Sept" / emoji on Firm OS pages, and an axe-core WCAG 2 A/AA audit (the engine Lighthouse's
// accessibility score is built on). Writes test-results/visual/check.json and prints a summary.
// Client-side steps (confirm steps opening, busy states) are covered by the render tests instead.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const DIR = join(process.cwd(), "test-results", "visual");
const WIDTHS = [390, 1280, 1440];
const LMS = new Set(["lms-dashboard", "lms-tools", "lms-clients", "lms-engagement-letter"]);
// The client page is LMS with one Firm OS card: its own forms and jobs table keep the LMS sizes.
const LMS_CONTROLS = new Set([...LMS, "client-firm-os-card"]);
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const pages = readdirSync(DIR)
  .filter((f) => f.endsWith(".html") && !["index.html", "frame.html", "montage.html"].includes(f))
  .map((f) => f.replace(/\.html$/, ""))
  .filter((s) => !only || only.has(s));

function inPage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const rows = [...document.querySelectorAll("table tbody tr")].filter(visible).map((tr) => Math.round(tr.getBoundingClientRect().height));
  const heads = [...document.querySelectorAll("table thead tr")].filter(visible).map((tr) => Math.round(tr.getBoundingClientRect().height));
  const cards = [...document.querySelectorAll(".shadow-lift.p-6, .rounded-2xl.p-6")].filter(visible).map((el) => getComputedStyle(el).paddingTop);
  const primaries = [...document.querySelectorAll("button, a")]
    .filter((el) => visible(el) && el.className.includes?.("bg-brand-500"))
    .map((el) => el.textContent.trim().slice(0, 40));
  const text = document.body.innerText;
  // Control heights on the grid: buttons 32 (24 compact, 36 nav pill / tab, 40 beside a field), fields 40.
  const buttons = [...new Set([...document.querySelectorAll("button")].filter(visible).map((b) => Math.round(b.getBoundingClientRect().height)))];
  const fields = [...new Set([...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select")].filter(visible).map((f) => Math.round(f.getBoundingClientRect().height)))];
  return {
    buttons,
    fields,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    rowMin: rows.length ? Math.min(...rows) : null,
    rowMax: rows.length ? Math.max(...rows) : null,
    headMin: heads.length ? Math.min(...heads) : null,
    cardPaddings: [...new Set(cards)],
    primaries,
    sept: /\bSept\b/.test(text),
    emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text),
  };
}

async function focusWalk(page, max = 80) {
  const misses = [];
  let reached = 0;
  const seen = new Set();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = s.boxShadow && s.boxShadow !== "none";
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const id = `${el.tagName}|${el.getAttribute("href") ?? ""}|${(el.textContent ?? "").trim().slice(0, 30)}|${el.getBoundingClientRect().top}`;
      return { id, ok: ring || outline, label: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"` };
    });
    if (!r) break;
    if (seen.has(r.id)) break; // wrapped round
    seen.add(r.id);
    reached++;
    if (!r.ok) misses.push(r.label);
  }
  return { reached, misses };
}

const browser = await chromium.launch({ channel: "chrome" });
const out = [];
for (const slug of pages) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(pathToFileURL(join(DIR, `${slug}.html`)).href);
    const m = await page.evaluate(inPage);
    const focus = await focusWalk(page);
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") }));
    });
    await page.close();
    const fails = [];
    if (m.overflow > 0) fails.push(`overflow ${m.overflow}px`);
    if (m.rowMin !== null && m.rowMin < 44) fails.push(`row ${m.rowMin}px`);
    if (m.headMin !== null && m.headMin < 44) fails.push(`head row ${m.headMin}px`);
    if (m.cardPaddings.some((p) => p !== "24px")) fails.push(`card padding ${m.cardPaddings.join("/")}`);
    const offButtons = LMS_CONTROLS.has(slug) ? [] : m.buttons.filter((h) => ![24, 32, 36, 40].includes(h));
    if (offButtons.length) fails.push(`button heights ${offButtons.join("/")}`);
    const offFields = LMS_CONTROLS.has(slug) ? [] : m.fields.filter((h) => h !== 40);
    if (offFields.length) fails.push(`field heights ${offFields.join("/")}`);
    if (focus.misses.length) fails.push(`no focus ring: ${focus.misses.slice(0, 3).join(", ")}`);
    if (axe.length) fails.push(`axe: ${axe.map((v) => `${v.id}×${v.nodes}`).join(", ")}`);
    if (m.primaries.length > 1) fails.push(`${m.primaries.length} primaries: ${m.primaries.join(" / ")}`);
    if (!LMS.has(slug) && (m.sept || m.emoji)) fails.push(m.sept ? "Sept" : "emoji");
    out.push({ slug, width, ...m, focusReached: focus.reached, focusMisses: focus.misses, axe, fails });
    console.log(`${fails.length ? "FAIL" : "pass"}  ${slug} @${width}  rows ${m.rowMin ?? "-"}–${m.rowMax ?? "-"}  focus ${focus.reached}  primaries ${m.primaries.length}${fails.length ? `  → ${fails.join("; ")}` : ""}`);
  }
}
await browser.close();
writeFileSync(join(DIR, "check.json"), JSON.stringify(out, null, 2));
const failed = out.filter((r) => r.fails.length);
console.log(`\n${out.length - failed.length}/${out.length} page × width checks pass → ${join(DIR, "check.json")}`);

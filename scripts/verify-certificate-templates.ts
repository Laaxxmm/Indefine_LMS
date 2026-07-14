import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CertificateTemplate, FieldDef } from "../src/lib/certificates/types";
import { canonicalLockedText, hashTemplate, lockedTextSegments, normalize } from "../src/lib/certificates/normalize";
import { registry } from "../src/lib/certificates/registry";

// §6 fidelity gate. For each template: every locked segment must appear verbatim (after
// normalization) and in order in the source-PDF pages; every fixed conditional clause
// (toggle fragments / optional-block text) must appear too; the module hash must match;
// enabled templates must be human-signed. Exit non-zero on any failure — wired into
// `npm run build` and CI so a bad transcription fails the build.

const ROOT = process.cwd(); // run via `npm run verify:certs` from the repo root
const ANCHOR_MIN = 20; // only order-check reasonably-unique segments; still presence-check all
const COVERAGE_WARN = 160; // flag uncovered source runs longer than this (heuristic, §6.4)

// Running headers / footers / bare page numbers repeat on every physical page and,
// after whitespace-collapse, inject themselves into the middle of paragraphs that span
// a page break. They are not certificate text, so strip whole lines that are exactly a
// known boilerplate header or a lone page number BEFORE normalizing.
const BOILERPLATE = [/^Illustrative Formats of Certificates$/, /^HB on Certificates by Chartered Accountants: Comprehensive Checklist & Formats$/, /^Annexure III$/, /^\d{1,3}$/];

function extractSource(pdfPath: string, pages: [number, number]): string {
  const abs = resolve(ROOT, pdfPath);
  if (!existsSync(abs)) throw new Error(`source PDF missing at ${pdfPath} (provision it privately — §3.3)`);
  const out = execFileSync("pdftotext", ["-layout", "-f", String(pages[0]), "-l", String(pages[1]), abs, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const kept = out.split(/\r?\n/).filter((line) => !BOILERPLATE.some((re) => re.test(line.trim())));
  return normalize(kept.join("\n"));
}

// Fixed conditional legal clauses that must also exist verbatim in the source:
// toggle onText/offText and enum fragments — but ONLY the clause-length ones. Short
// grammatical fragments (I/we -> "we"/"I", "Our", "us"...) are deliberately excluded:
// the source always prints them as slash-pairs ("I/we"), so the capitalized/expanded
// forms never appear standalone. Their fidelity is instead guaranteed by the leak
// guard, which fails if a slash-pair survives into output. optionalBlock body text is
// always checked (it is real legal wording).
const CLAUSE_MIN = 8;
function fixedConditionalStrings(fields: FieldDef[]): string[] {
  const out: string[] = [];
  const walk = (fs: FieldDef[]) => {
    for (const f of fs) {
      for (const o of f.options ?? []) if (o.fragment.trim().length >= CLAUSE_MIN) out.push(o.fragment);
      if ((f.onText?.trim().length ?? 0) >= CLAUSE_MIN) out.push(f.onText!);
      if ((f.offText?.trim().length ?? 0) >= CLAUSE_MIN) out.push(f.offText!);
      for (const s of f.subSegments ?? []) if (s.kind === "text") out.push(s.text);
      if (f.subFields) walk(f.subFields);
    }
  };
  walk(fields);
  return out;
}

interface Result {
  id: string;
  failures: string[];
  warnings: string[];
}

function verifyOne(t: CertificateTemplate): Result {
  const failures: string[] = [];
  const warnings: string[] = [];
  const short = (s: string) => (s.length > 70 ? s.slice(0, 67) + "..." : s);

  let src = "";
  try {
    src = extractSource(t.sourcePdf, t.sourcePages);
  } catch (e) {
    return { id: t.id, failures: [(e as Error).message], warnings };
  }

  const locked = lockedTextSegments(t).map(normalize).filter((s) => s !== "");

  // 1+2+3. presence + order (order judged on anchor-length segments to avoid tiny-string noise)
  let cursor = 0;
  const matchedRanges: [number, number][] = [];
  for (const seg of locked) {
    const anywhere = src.indexOf(seg);
    if (anywhere === -1) {
      failures.push(`NOT FOUND in source: "${short(seg)}"`);
      continue;
    }
    const fromCursor = src.indexOf(seg, cursor);
    if (seg.length >= ANCHOR_MIN) {
      if (fromCursor === -1) failures.push(`OUT OF ORDER (appears before prior text): "${short(seg)}"`);
      else {
        matchedRanges.push([fromCursor, fromCursor + seg.length]);
        cursor = fromCursor + seg.length;
      }
    }
    // short segments: presence-checked above, but not used for order/coverage (too common to anchor)
  }

  // conditional fixed clauses (order not enforced — they render conditionally)
  for (const s of fixedConditionalStrings(t.fields).map(normalize)) {
    if (s && src.indexOf(s) === -1) failures.push(`CONDITIONAL CLAUSE not in source: "${short(s)}"`);
  }

  // 4. coverage — flag large uncovered runs of source between matched anchors
  matchedRanges.sort((a, b) => a[0] - b[0]);
  let covEnd = 0;
  for (const [a, b] of matchedRanges) {
    if (a - covEnd > COVERAGE_WARN) warnings.push(`uncovered source run (${a - covEnd} chars) near: "${short(src.slice(covEnd, a))}"`);
    covEnd = Math.max(covEnd, b);
  }

  // 5. hash
  const computed = hashTemplate(t);
  if (t.hash !== computed) failures.push(`hash drift: module=${t.hash || "(empty)"} computed=${computed}`);

  // 6. sign-off for enabled
  if (t.status === "enabled" && (!t.verifiedBy || !t.verifiedAt)) failures.push(`enabled but not human-signed (verifiedBy/verifiedAt missing)`);

  return { id: t.id, failures, warnings };
}

function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : undefined;
  const targets = only ? registry.filter((t) => t.id === only) : registry;
  if (only && targets.length === 0) {
    console.error(`no template with id "${only}"`);
    process.exit(2);
  }

  let failed = 0;
  for (const t of targets) {
    // draft templates with no locked text yet are skipped (scaffolds — §10.9)
    if (t.status === "draft" && lockedTextSegments(t).length === 0) {
      console.log(`• ${t.id} [draft, not transcribed] — skipped`);
      continue;
    }
    const r = verifyOne(t);
    for (const w of r.warnings) console.log(`  ⚠ ${r.id}: ${w}`);
    if (r.failures.length) {
      failed++;
      console.error(`✗ ${r.id} — ${r.failures.length} failure(s):`);
      for (const f of r.failures) console.error(`    ${f}`);
      console.error(`    correct hash: ${hashTemplate(registry.find((x) => x.id === r.id)!)}`);
    } else {
      console.log(`✓ ${r.id} — verifier clean (hash ${hashTemplate(t).slice(0, 12)}…)`);
    }
  }

  if (failed) {
    console.error(`\n${failed} template(s) failed verification.`);
    process.exit(1);
  }
  console.log(`\nAll ${targets.length} target template(s) OK.`);
}

main();

// UI link check: every internal link, redirect and router target in src/ goes to a page that
// exists, every client API call goes to a route.ts that exports its method, and target="_blank"
// links carry rel="noopener". Rules in scripts/lib/ui-links.ts. Exit 1 on any error; warnings
// (admin links in files with no admin check) are printed but do not fail.
//
//   npx tsx scripts/verify-ui-links.ts            errors + warnings + summary
//   npx tsx scripts/verify-ui-links.ts --verbose  also every unresolved (dynamic) target
import { checkUiLinks, formatFinding, isScanned, WILD } from "./lib/ui-links";
import { listRepoFiles, loadFiles } from "./lib/repo-files";

const verbose = process.argv.includes("--verbose");
const files = loadFiles((p) => isScanned(p) || p.startsWith("src/app/"));
const publicFiles = listRepoFiles().filter((p) => p.startsWith("public/"));
const { findings, targets, stats } = checkUiLinks(files, { publicFiles });

for (const f of findings) console.log(formatFinding(f));
if (verbose) {
  for (const t of targets.filter((x) => !x.pattern && !x.external)) console.log(`${t.file}:${t.line}  unresolved ${t.kind} (${t.via})  ${t.raw.replace(new RegExp(WILD, "g"), "${…}")}`);
}

const errors = findings.filter((f) => f.level === "error").length;
const warns = findings.length - errors;
const k = stats.byKind;
const summary =
  `${stats.files} file(s), ${stats.pages} page(s), ${stats.handlers} route handler(s); checked ${stats.checked} target(s) ` +
  `(nav ${k.nav}, api calls ${k["api-call"]}, forms ${k.form}, other /api refs ${k["api-ref"]}), ${stats.unresolved} dynamic target(s) not resolvable statically`;
if (errors) {
  console.error(`verify-ui-links: FAILED — ${errors} error(s), ${warns} warning(s). ${summary}`);
  process.exit(1);
}
console.log(`verify-ui-links: OK — ${warns} warning(s). ${summary}`);

// Per-task AI guardrail profiles (ADR-009). Generates docs/ai/guardrail-profiles.md from the task
// registries (every scoped agent in src/lib/agents/registry.ts, plus the onboarding extractor).
//
//   npx tsx scripts/ai-guardrail-profiles.ts            write the document
//   npx tsx scripts/ai-guardrail-profiles.ts --check    exit 1 when the committed document is stale (CI)
//   [--out=<path>]                                      another output file (tests)
//
// Exit codes: 0 ok / written · 1 stale · 2 usage error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROFILES_DOC, guardrailProfilesMarkdown } from "@/lib/agents/core/guardrails/profiles";
import { AGENTS } from "@/lib/agents/registry";

function main(argv: string[]): number {
  let check = false;
  let out = PROFILES_DOC;
  for (const arg of argv) {
    if (arg === "--check") check = true;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else {
      console.error(`ai-guardrail-profiles: unknown argument ${arg} (use --check or --out=<path>)`);
      return 2;
    }
  }
  const doc = guardrailProfilesMarkdown(AGENTS);
  if (check) {
    const current = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : null;
    if (current !== doc) {
      console.error(`ai-guardrail-profiles: ${out} is ${current === null ? "missing" : "out of date"} — run npx tsx scripts/ai-guardrail-profiles.ts and commit the result.`);
      return 1;
    }
    console.log(`ai-guardrail-profiles: ${out} is up to date.`);
    return 0;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, doc);
  console.log(`ai-guardrail-profiles: ${out} written.`);
  return 0;
}

process.exit(main(process.argv.slice(2)));

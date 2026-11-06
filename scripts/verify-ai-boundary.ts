// Firm OS guard (NON-NEGOTIABLE 3): model SDKs and model hosts only under src/lib/ai/providers/.
// An import-graph rule (scripts/lib/guards.ts checkAiBoundary): folded SDK specifiers and model
// hosts, env-built model egress, provider imports outside the router, and the legacy Gemini
// boundary — LEGACY_GEMINI egress files may be imported only by LEGACY_GEMINI_CALLERS, each of
// which must reach the mask gate (src/lib/ai/legacy-gate.ts); Firm OS code never reaches Gemini.
import { LEGACY_GEMINI, LEGACY_GEMINI_CALLERS, checkAiBoundary } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !p.split("/").includes("node_modules"));
report(
  "verify-ai-boundary",
  checkAiBoundary(files),
  `${files.length} code files scanned (import graph); SDKs and model hosts only in src/lib/ai/providers/, ${LEGACY_GEMINI.length} legacy Gemini egress file(s), ${LEGACY_GEMINI_CALLERS.length} allow-listed caller(s) behind the mask gate`,
  LEGACY_GEMINI_CALLERS.map((c) => `legacy Gemini caller ${c.path}: ${c.why} Gate: ${c.gateNote}.`),
);

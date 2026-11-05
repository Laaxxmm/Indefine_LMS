// Firm OS guard (NON-NEGOTIABLE 3): model SDKs and provider hosts only under src/lib/ai/providers/.
// Legacy direct Gemini REST callers are frozen in LEGACY_GEMINI; no new file may join it.
import { LEGACY_GEMINI, checkAiBoundary } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !p.split("/").includes("node_modules"));
report(
  "verify-ai-boundary",
  checkAiBoundary(files),
  `${files.length} code files scanned; SDKs only in src/lib/ai/providers/, ${LEGACY_GEMINI.length} legacy Gemini file(s)`,
);

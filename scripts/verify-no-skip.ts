// Firm OS guard (NON-NEGOTIABLE 4): no skipped, focused or todo tests under src/, tests/, scripts/.
import { checkNoSkip } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles((p) => /^(src|tests|scripts)\//.test(p) && /\.(ts|tsx|js|mjs)$/.test(p));
report("verify-no-skip", checkNoSkip(files), `${files.length} test/source files scanned, no skip/only/todo`);

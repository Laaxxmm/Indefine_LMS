// Firm OS guard: regex secret scan of every tracked or new text file (gitleaks is not installed).
// Skips node_modules, lockfiles and binaries (*.zip, *.pdf, images, fonts, Office files).
import { checkSecrets, isSecretScanCandidate } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles(isSecretScanCandidate);
report("verify-secrets", checkSecrets(files), `${files.length} text files scanned, no secrets found`);

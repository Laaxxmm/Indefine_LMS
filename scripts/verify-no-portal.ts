// Firm OS guard (NON-NEGOTIABLE 1): no code path to the GST, MCA, Income-tax or TRACES portals.
// Legacy read-only statutory-update readers are listed, with reasons, in LEGACY_PORTAL_READONLY.
import { LEGACY_PORTAL_READONLY, checkNoPortal } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles((p) => /^(src|scripts|statutory-extension|neo-centra-extension)\//.test(p));
report(
  "verify-no-portal",
  checkNoPortal(files),
  `${files.length} files scanned; ${LEGACY_PORTAL_READONLY.length} legacy read-only file(s) allowlisted, none submit`,
);

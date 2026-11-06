// Firm OS guard (NON-NEGOTIABLE 2): Firm OS code exposes no delete path (HTTP DELETE, Prisma
// delete/deleteMany, delete/remove/purge/destroy/drop functions, destructive Graph helpers).
import { NO_DELETE_EXEMPTIONS, NO_DELETE_SCOPE, checkNoDelete, inNoDeleteScope } from "./lib/guards";
import { loadFiles, report } from "./lib/repo-files";

const files = loadFiles(inNoDeleteScope);
report("verify-no-delete", checkNoDelete(files), `${files.length} Firm OS file(s) scanned, no delete path`, [
  `scope is Firm OS code only (${NO_DELETE_SCOPE.length} paths); legacy LMS files (e.g. src/lib/graph.ts) were not scanned`,
  ...NO_DELETE_EXEMPTIONS.map((e) => `exemption (${e.adr}): ${e.path} ${e.fn}() may delete from ${e.models.join(" and ")} only — ${e.why}`),
]);

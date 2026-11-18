// Firm OS feature flags for SharePoint Path A. Default OFF (ORCHESTRATOR non-negotiable #7).
type Env = Record<string, string | undefined>;

const ON = new Set(["1", "true", "on", "yes"]);

/** FIRM_OS_CL_PATHS: /clients folder links resolve to CL-{Code} sites (docs/folder-contract.md §5). */
export function isClPathsEnabled(env: Env = process.env): boolean {
  return ON.has((env.FIRM_OS_CL_PATHS ?? "").trim().toLowerCase());
}

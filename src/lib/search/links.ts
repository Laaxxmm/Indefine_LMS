// The page each search result opens. Written as `href:` objects so `npm run verify:ui-links`
// checks every pattern against src/app. Server- and client-safe.
//
// Comms drafts have no page of their own yet (Phase 10 adds /comms); until it lands a draft opens
// its client's page. Switch draftLink() to the comms page in one place when it exists.

export const clientLink = (clientId: string) => ({ href: `/clients/${encodeURIComponent(clientId)}` });

/** The client's page, scrolled to its Firm OS jobs (that section shows only under FIRM_OS_CL_PATHS). */
export const clientFirmJobsLink = (clientId: string) => ({ href: `/clients/${encodeURIComponent(clientId)}#firm-os-jobs` });

export const runLink = (agent: string, runId: string) => ({ href: `/agents/${encodeURIComponent(agent)}/runs/${encodeURIComponent(runId)}` });

export const onboardingLink = (runId: string) => ({ href: `/onboard?run=${encodeURIComponent(runId)}` });

export const draftLink = (clientId: string) => clientLink(clientId);

/**
 * A Firm OS job opens its latest agent run (the review page shows the job), or its client's page
 * when no agent has run on it yet.
 */
export function jobLink(job: { lmsClientId: string; latestRun: { id: string; agent: string } | null }, clPaths: boolean): { href: string } {
  if (job.latestRun) return runLink(job.latestRun.agent, job.latestRun.id);
  return clPaths ? clientFirmJobsLink(job.lmsClientId) : clientLink(job.lmsClientId);
}

/** The full results page for a text query (never used for identifiers: they stay out of URLs). */
export function searchPageLink(q: string, type?: string | null): { href: string } {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  const qs = params.toString();
  return { href: qs ? `/search?${qs}` : `/search` };
}

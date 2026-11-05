// The database reads (and the one audit write) search makes, and its dependencies. PrismaClient
// satisfies SearchDb; tests pass an in-memory fake (tests/fakes/search-world.ts).
import type { PrismaClient } from "@prisma/client";
import type { SearchRateLimiter } from "./rate-limit";

export type SearchDb = Pick<PrismaClient, "client" | "firmClient" | "jobTask" | "agentRun" | "deliverable" | "commsDraft" | "onboardingRun" | "job" | "clientDocument" | "auditEvent">;

export type SearchDeps = {
  db: SearchDb;
  /** Identifier searches per person (rate-limit.ts). */
  limiter: SearchRateLimiter;
  /** FIRM_OS_CL_PATHS: a Firm OS job without a run links to its client's Firm OS jobs section. */
  clPaths: boolean;
  now: () => Date;
};

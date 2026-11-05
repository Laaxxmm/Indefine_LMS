// The database reads search makes, and its dependencies. PrismaClient satisfies SearchDb; tests
// pass an in-memory fake (tests/fakes/search-world.ts).
import type { PrismaClient } from "@prisma/client";

export type SearchDb = Pick<PrismaClient, "client" | "firmClient" | "jobTask" | "agentRun" | "deliverable" | "commsDraft" | "onboardingRun" | "job" | "clientDocument" | "auditEvent">;

export type SearchDeps = {
  db: SearchDb;
  /** FIRM_OS_CL_PATHS: a Firm OS job without a run links to its client's Firm OS jobs section. */
  clPaths: boolean;
  now: () => Date;
};
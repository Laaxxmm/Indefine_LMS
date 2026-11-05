// Production dependencies for search: Prisma, the shared identifier rate limiter, the
// FIRM_OS_CL_PATHS flag. To use the Phase 11 database-backed limiter, pass it as `limiter` here.
import { prisma } from "@/lib/prisma";
import { isClPathsEnabled } from "@/lib/integrations/sharepoint/flags";
import type { SearchDb, SearchDeps } from "./db";
import { identifierRateLimiter } from "./rate-limit";

export function defaultSearchDeps(): SearchDeps {
  return { db: prisma as unknown as SearchDb, limiter: identifierRateLimiter(), clPaths: isClPathsEnabled(), now: () => new Date() };
}

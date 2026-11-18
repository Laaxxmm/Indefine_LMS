import { PrismaClient } from "@prisma/client";

// Prisma's default pool is num_cpus*2+1, and Railway exposes the host's cores, so a
// burst (computeKraScores fans out a query per user) can open dozens of Postgres
// backends that then sit idle holding RAM. A 16-person app needs a handful.
// An explicit connection_limit in DATABASE_URL still wins.
function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=5`;
}

const createPrisma = () =>
  new PrismaClient({
    datasourceUrl: databaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Video.sourceText holds whole transcripts. Nearly every page that lists videos
    // never reads it, so leave it out unless a query asks for it (select / omit: false).
    omit: { video: { sourceText: true } },
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrisma> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrisma();

// Always pin it: Next can evaluate this module once per server bundle layer, and
// each extra PrismaClient brings its own engine and connection pool.
globalForPrisma.prisma = prisma;

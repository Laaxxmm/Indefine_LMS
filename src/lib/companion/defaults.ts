// Production wiring for the companion routes: Prisma, this module's own job selection, the
// database rate limiter and the extension origins from the environment. Tests build their deps
// from fakes instead. To switch to the shared getNextTask, pass `source` to createCompanionProvider
// (provider.ts explains the mapping). The limiter is the shared database one (rate-limit.ts).
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedExtensionOrigins } from "./config";
import type { NextTaskDeps } from "./http";
import { createCompanionProvider } from "./provider";
import { databaseCompanionRateLimiter } from "./rate-limit";
import type { CompanionTokenDb } from "./tokens";

/** The shared client, typed as a plain PrismaClient (it is built with an `omit` option the companion never touches). */
export function companionDb(): PrismaClient {
  return prisma as unknown as PrismaClient;
}

export function pairingDb(): CompanionTokenDb {
  return companionDb();
}

export function nextTaskDeps(): NextTaskDeps {
  const db = companionDb();
  return { db, provider: createCompanionProvider({ db }), limiter: databaseCompanionRateLimiter, origins: allowedExtensionOrigins() };
}

// Production wiring for the companion routes: Prisma, the shared next-task queue (fromNextTaskView:
// the side panel shows what /focus shows), the in-process rate limiter and the extension origins
// from the environment. Tests build their deps from fakes instead. To switch to the Phase 11
// database limiter, replace `limiter`.
import type { PrismaClient } from "@prisma/client";
import type { FirmDb } from "@/lib/agents/core/runner";
import { prisma } from "@/lib/prisma";
import { allowedExtensionOrigins } from "./config";
import type { NextTaskDeps } from "./http";
import { createCompanionProvider, fromNextTaskView } from "./provider";
import { companionRateLimiter } from "./rate-limit";
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
  const provider = createCompanionProvider({ db, source: fromNextTaskView({ db: db as unknown as FirmDb }) });
  return { db, provider, limiter: companionRateLimiter, origins: allowedExtensionOrigins() };
}

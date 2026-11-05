// Production wiring for the companion routes. Tests build their deps from fakes instead.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CompanionTokenDb } from "./tokens";

/** The shared client, typed as a plain PrismaClient (it is built with an `omit` option the companion never touches). */
export function companionDb(): PrismaClient {
  return prisma as unknown as PrismaClient;
}

export function pairingDb(): CompanionTokenDb {
  return companionDb();
}

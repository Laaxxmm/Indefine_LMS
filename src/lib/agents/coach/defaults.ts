// Production wiring for the coach: Prisma, the real clock and the firm calendar (FIRM_OS_HOLIDAYS
// added). Routes, pages and the cron call these; tests build the deps from an in-memory fake.
import { prisma } from "@/lib/prisma";
import { calendarFromEnv } from "./config";
import type { CoachCronDeps } from "./cron";
import type { CoachDb } from "./db";

export function coachDb(): CoachDb {
  return prisma;
}

export function coachDeps(): CoachCronDeps {
  return { db: coachDb(), now: () => new Date(), calendar: calendarFromEnv() };
}

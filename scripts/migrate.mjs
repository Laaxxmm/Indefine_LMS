// Boot-time schema step, run by `npm start` before `next start`.
//
//   fresh database              → prisma migrate deploy creates everything
//   existing database, first    → the tables already exist from the old `prisma db push`
//   boot after this change        era, so record the baseline migration (0_init) as
//                                 applied without running it, then deploy the rest
//   every later boot            → prisma migrate deploy applies pending migrations only
//
// Nothing here can drop data: migrate deploy runs only the SQL committed under
// prisma/migrations, and a migration that fails stops the boot instead of continuing.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const exists = async (rel) => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public."${rel}"') IS NOT NULL AS ok`))[0].ok;
const hasUsers = await exists("User");
const hasMigrations = await exists("_prisma_migrations");
await prisma.$disconnect();

const run = (cmd) => { console.log(`[migrate] ${cmd}`); execSync(cmd, { stdio: "inherit" }); };
if (hasUsers && !hasMigrations) {
  console.log("[migrate] existing database without a migration history: recording 0_init as the baseline");
  run("npx prisma migrate resolve --applied 0_init");
}
run("npx prisma migrate deploy");

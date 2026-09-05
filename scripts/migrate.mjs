// Boot-time schema step, run by `npm start` before `next start`.
//
//   fresh database              → prisma migrate deploy creates everything
//   existing database, first    → the tables already exist from the old `prisma db push`
//   boot after this change        era, so record the baseline migration (0_init) as
//                                 applied without running it, then deploy the rest
//   a migration that started    → Prisma refuses every later deploy (P3009) until it is
//   but never finished            resolved. Print what Prisma recorded, mark it rolled
//                                 back, and let deploy retry it. Migrations in this repo
//                                 are written to be re-runnable (ADD COLUMN IF NOT EXISTS),
//                                 so retrying a half-applied one is safe.
//   every later boot            → prisma migrate deploy applies pending migrations only
//
// Nothing here can drop data: migrate deploy runs only the SQL committed under
// prisma/migrations, and a migration that fails stops the boot instead of continuing.
import { execSync, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = (sql) => prisma.$queryRawUnsafe(sql);
const exists = async (rel) => (await rows(`SELECT to_regclass('public."${rel}"') IS NOT NULL AS ok`))[0].ok;
const run = (cmd) => { console.log(`[migrate] ${cmd}`); execSync(cmd, { stdio: "inherit" }); };
const show = (cmd) => { console.log(`[migrate] ${cmd}`); spawnSync(cmd, { shell: true, stdio: "inherit" }); };

const hasUsers = await exists("User");
const hasMigrations = await exists("_prisma_migrations");
const stuck = hasMigrations
  ? await rows(`SELECT migration_name, started_at, logs FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at`)
  : [];
await prisma.$disconnect();

if (hasUsers && !hasMigrations) {
  console.log("[migrate] existing database without a migration history: recording 0_init as the baseline");
  run("npx prisma migrate resolve --applied 0_init");
}
for (const m of stuck) {
  const when = m.started_at instanceof Date ? m.started_at.toISOString() : String(m.started_at);
  console.log(`[migrate] ${m.migration_name} started ${when} and never finished. Prisma recorded:\n${String(m.logs ?? "(no logs)").slice(0, 2000)}`);
  console.log(`[migrate] marking it rolled back so deploy can retry it`);
  run(`npx prisma migrate resolve --rolled-back ${m.migration_name}`);
}
show("npx prisma migrate status"); // informational: exits non-zero while migrations are pending
run("npx prisma migrate deploy");

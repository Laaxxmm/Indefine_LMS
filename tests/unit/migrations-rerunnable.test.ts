// Production incident 06 Nov 2026: the first Firm OS migration half-applied on boot, and every
// restart then failed on `CREATE TYPE "ModelProviderId"` ("already exists") because the boot script
// (scripts/migrate.mjs) marks a half-applied migration rolled back and retries it. Every migration
// from the Firm OS era on must therefore be safe to apply again over its own partial state.
// CI (firm-os-ci.yml, e2e job) also re-applies each of these files with psql on a real Postgres.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "prisma", "migrations");
const FROM = "20261105190000"; // first Firm OS migration; older ones predate the boot retry
const migrations = readdirSync(DIR)
  .filter((d) => d >= FROM && statSync(join(DIR, d)).isDirectory())
  .map((d) => ({ name: d, sql: readFileSync(join(DIR, d, "migration.sql"), "utf8") }));

/** Statements outside DO $$ … $$ blocks, comments stripped. */
function topLevel(sql: string): string[] {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const outside = noComments.replace(/DO \$\$[\s\S]*?\$\$;/g, "").replace(/AS \$\$[\s\S]*?\$\$;/g, "");
  return outside.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

describe("Firm OS migrations are re-runnable", () => {
  it("finds the migrations", () => {
    expect(migrations.map((m) => m.name)).toContain("20261105190000_firm_os_spine");
  });

  it.each(migrations.map((m) => [m.name, m.sql]))("%s guards every create, column and constraint", (_name, sql) => {
    for (const stmt of topLevel(sql)) {
      expect(stmt, stmt).not.toMatch(/^CREATE TYPE /);
      expect(stmt, stmt).not.toMatch(/^CREATE TRIGGER /);
      if (/^CREATE TABLE /.test(stmt)) expect(stmt, stmt).toMatch(/^CREATE TABLE IF NOT EXISTS /);
      if (/^CREATE (UNIQUE )?INDEX /.test(stmt)) expect(stmt, stmt).toMatch(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS /);
      expect(stmt, stmt).not.toMatch(/ADD CONSTRAINT/);
      expect(stmt, stmt).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS )/);
      expect(stmt, stmt).not.toMatch(/^(DROP|TRUNCATE|DELETE)\b/); // additive only
    }
  });

  it("guarded creates ignore only the duplicate, never other errors", () => {
    for (const m of migrations) {
      for (const block of m.sql.match(/DO \$\$ BEGIN[\s\S]*?END \$\$;/g) ?? []) {
        expect(block, m.name).toMatch(/EXCEPTION WHEN duplicate_object( OR duplicate_table)? THEN NULL;/);
        expect(block, m.name).not.toMatch(/WHEN OTHERS/);
      }
    }
  });
});

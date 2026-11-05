// Source guard for the Path A integration: no destructive Graph helpers imported, no
// destructive HTTP verbs, no destructive SharePoint REST calls (ORCHESTRATOR non-negotiable #2).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = __dirname;
const SCRIPTS = join(DIR, "../../../../scripts");
/** Scripts that must never write to Graph or the database. */
const READ_ONLY_SCRIPTS = [join(SCRIPTS, "verify-patha.ts")];
const sources = [...readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(DIR, f)), ...READ_ONLY_SCRIPTS];

// Built from parts so this guard file does not itself trip repo-wide grep gates.
const word = (...parts: string[]) => parts.join("");
const FORBIDDEN_IMPORTS = [word("delete", "DriveItem"), word("delete", "Event"), word("send", "MailAsUser"), word("move", "DriveItem")];
const FORBIDDEN_VERBS = new RegExp(`["'\`](${[word("DEL", "ETE"), word("PAT", "CH"), word("PU", "T"), word("MER", "GE")].join("|")})["'\`]`);
const FORBIDDEN_REST = new RegExp(`/(${[word("recy", "cle"), word("delete", "Object"), word("Delete", "Site"), word("remove", "byid"), word("Remove", "Site")].join("|")})`, "i");

describe("Path A sources have no destructive surface", () => {
  it.each(sources)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    for (const name of FORBIDDEN_IMPORTS) expect(src, name).not.toContain(name);
    expect(src).not.toMatch(FORBIDDEN_VERBS);
    expect(src).not.toMatch(FORBIDDEN_REST);
  });

  it("scans every module file", () => {
    expect(sources.length).toBeGreaterThanOrEqual(9);
  });

  // Read-only scripts: no ensure-*/create* calls, no clfolders import, no Prisma writes.
  it.each(READ_ONLY_SCRIPTS)("%s is read-only", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/\bensure[A-Z]\w*\(/);
    expect(src).not.toMatch(/\.create\w*\(/);
    expect(src).not.toMatch(/clfolders/);
    expect(src).not.toMatch(/\.(update|upsert|createMany|updateMany|executeRaw\w*)\(/);
    expect(src).not.toMatch(/writeFile(Sync)?\([^)]*(graph|sharepoint)/i);
  });
});

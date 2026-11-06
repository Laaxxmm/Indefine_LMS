// Source guard for the Path A integration: no destructive Graph helpers imported, no
// destructive HTTP verbs, no destructive SharePoint REST calls (ORCHESTRATOR non-negotiable #2).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = __dirname;
const SCRIPTS = join(DIR, "../../../../scripts");
/** Scripts that must never write to Graph or the database. */
const READ_ONLY_SCRIPTS = [join(SCRIPTS, "verify-patha.ts"), join(SCRIPTS, "map-legacy-folders.ts")];
const sources = [...readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(DIR, f)), ...READ_ONLY_SCRIPTS];

// Built from parts so this guard file does not itself trip repo-wide grep gates.
const word = (...parts: string[]) => parts.join("");
const FORBIDDEN_IMPORTS = [word("delete", "DriveItem"), word("delete", "Event"), word("send", "MailAsUser"), word("move", "DriveItem")];
const PUT_LITERAL = new RegExp(`["'\`]${word("PU", "T")}["'\`]`, "g");
const FORBIDDEN_VERBS = new RegExp(`["'\`](${[word("DEL", "ETE"), word("PAT", "CH"), word("PU", "T"), word("MER", "GE")].join("|")})["'\`]`);
const FORBIDDEN_VERBS_EXCEPT_UPLOAD = new RegExp(`["'\`](${[word("DEL", "ETE"), word("PAT", "CH"), word("MER", "GE")].join("|")})["'\`]`);
const FORBIDDEN_REST = new RegExp(`/(${[word("recy", "cle"), word("delete", "Object"), word("Delete", "Site"), word("remove", "byid"), word("Remove", "Site")].join("|")})`, "i");
const GRAPH_CLIENT = join(DIR, "graph-client.ts");

describe("Path A sources have no destructive surface", () => {
  it.each(sources)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    for (const name of FORBIDDEN_IMPORTS) expect(src, name).not.toContain(name);
    // Graph's create-only file upload is the one PUT, confined to graph-client.ts (next test).
    expect(src).not.toMatch(file === GRAPH_CLIENT ? FORBIDDEN_VERBS_EXCEPT_UPLOAD : FORBIDDEN_VERBS);
    expect(src).not.toMatch(FORBIDDEN_REST);
  });

  // Graph defines file-content upload as PUT. It may exist only as one constant used by one
  // helper, and that helper may only receive conflictBehavior=fail URLs or a session created
  // with conflictBehavior "fail" — so the verb can create files but never replace one.
  it("graph-client.ts confines the upload verb to putContent with conflictBehavior=fail", () => {
    const src = readFileSync(GRAPH_CLIENT, "utf8");
    const literals = src.match(PUT_LITERAL) ?? [];
    expect(literals).toHaveLength(1);
    expect(src).toMatch(new RegExp(`const UPLOAD_VERB = ["']${word("PU", "T")}["'] as const;`));
    expect(src.match(/method:\s*UPLOAD_VERB/g)).toHaveLength(1);
    const helper = src.slice(src.indexOf("async function putContent("), src.indexOf("async function json<"));
    expect(helper).toMatch(/method:\s*UPLOAD_VERB/);
    // Exactly two call sites: the simple upload (uploadUrlFor) and the session chunks (uploadUrl).
    const calls = [...src.matchAll(/await putContent\((\w+),/g)].map((m) => m[1]);
    expect(calls.sort()).toEqual(["uploadUrl", "url"]);
    expect(src).toMatch(/const url = uploadUrlFor\(driveId, path\);\s*\n\s*const res = await putContent\(url,/);
    expect(src).toMatch(/const uploadUrlFor = [^\n]*:\/content\?@microsoft\.graph\.conflictBehavior=fail`/);
    expect(src).toMatch(/createUploadSession`;\s*\n\s*const created = await send\("POST", sessionUrl, G, \{ item: \{ "@microsoft\.graph\.conflictBehavior": "fail" \} \}\)/);
    expect(src).not.toMatch(/conflictBehavior["']?\s*[:=]\s*["'](replace|rename)/);
    expect(src).not.toMatch(/conflictBehavior=(replace|rename)/);
  });

  it("scans every module file", () => {
    expect(sources.length).toBeGreaterThanOrEqual(13);
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

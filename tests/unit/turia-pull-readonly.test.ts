// Firm OS reads Turia and never writes to it (ADR-003 amendment, owner's hard limit).
//
//   1. the allowlist   holds only list / get reads (task/list, task/get, utilities/organizationUserListNew,
//                      timesheet/list) and nothing that creates, updates, closes, assigns, logs or removes
//   2. the gate        turiaRead() refuses anything else before a request is made
//   3. the reader      makes only allowlisted calls, and has no other methods
//   4. the code        under the pull's folder and the routes that run it: only read-client.ts imports
//                      turiaPost, every literal Turia call there is allowlisted, nothing calls fetch or
//                      Turia's address directly, and no Turia adapter write (createTask, closeTask …) is called
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TURIA_READ_ALLOWLIST, TuriaReadOnlyError, createTuriaReader, isReadAction, turiaRead } from "@/lib/integrations/turia/pull/read-client";

const ROOT = process.cwd();
const SCOPE = ["src/lib/integrations/turia/pull", "src/app/api/cron/firm-os/turia-pull", "src/app/api/firm-os/turia-sync", "src/app/admin/firm-os/turia-sync"];
const WRITE_WORDS = /create|update|edit|save|add|close|complete|assign|delete|remove|archive|log|post|put|patch|set|mark|approve|import|upload/i;

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  return readdirSync(abs).flatMap((f) => {
    const p = join(abs, f);
    if (statSync(p).isDirectory()) return files(join(dir, f));
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [join(dir, f).replace(/\\/g, "/")] : [];
  });
}
const code = SCOPE.flatMap(files).map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

describe("1. the allowlist", () => {
  it("is exactly the four read calls", () => {
    expect(TURIA_READ_ALLOWLIST.map((a) => `${a.endpoint}/${a.action}`)).toEqual(["task/list", "task/get", "utilities/organizationUserListNew", "timesheet/list"]);
  });

  it("holds only list / get actions, none of them a write", () => {
    for (const a of TURIA_READ_ALLOWLIST) {
      expect(a.action, a.action).toMatch(/^(list|get|organizationUserListNew)$/);
      expect(a.action, a.action).not.toMatch(WRITE_WORDS);
      expect(a.why.length).toBeGreaterThan(10);
    }
    expect(Object.isFrozen(TURIA_READ_ALLOWLIST)).toBe(true);
  });
});

describe("2. the gate", () => {
  it.each([
    ["task", "create"],
    ["task", "update"],
    ["task", "close"],
    ["task", "delete"],
    ["task", "assign"],
    ["timesheet", "add"],
    ["client", "list"],
    ["invoice", "list"],
    ["leads", "list"],
  ])("refuses %s/%s before any request", async (endpoint, action) => {
    const post = vi.fn(async () => ({}));
    expect(isReadAction(endpoint, action)).toBe(false);
    await expect(turiaRead(post, endpoint, action, {})).rejects.toBeInstanceOf(TuriaReadOnlyError);
    expect(post).not.toHaveBeenCalled();
  });

  it("passes an allowlisted read through unchanged", async () => {
    const post = vi.fn(async () => ({ ok: 1 }));
    await expect(turiaRead(post, "task", "get", { id: "1" })).resolves.toEqual({ ok: 1 });
    expect(post).toHaveBeenCalledWith("task", "get", { id: "1" });
  });
});

describe("3. the reader", () => {
  it("makes only allowlisted calls and has only read methods", async () => {
    const seen: string[] = [];
    const post = vi.fn(async (endpoint: string, action: string) => {
      seen.push(`${endpoint}/${action}`);
      return { tasks: { tasks: [] }, users: [], tasktimesheets: [] };
    });
    const reader = createTuriaReader(post);
    await reader.taskPage(1, 500, "createdon");
    await reader.orgUsers();
    await reader.taskMinutes("1");
    expect(seen.every((s) => TURIA_READ_ALLOWLIST.some((a) => `${a.endpoint}/${a.action}` === s))).toBe(true);
    expect((post.mock.calls[0] as unknown[])[2]).toMatchObject({ perPage: 100 }); // never more than 100 a page
    expect(Object.keys(reader).sort()).toEqual(["orgUsers", "taskMinutes", "taskPage"]);
  });
});

describe("4. the code", () => {
  it("finds the pull's files", () => {
    expect(code.map((f) => f.path)).toEqual(expect.arrayContaining(["src/lib/integrations/turia/pull/sync.ts", "src/lib/integrations/turia/pull/read-client.ts", "src/app/api/cron/firm-os/turia-pull/route.ts"]));
  });

  it("only read-client.ts imports turiaPost, and nothing calls fetch or Turia's address directly", () => {
    for (const f of code) {
      if (f.path !== "src/lib/integrations/turia/pull/read-client.ts") expect(f.text, f.path).not.toMatch(/\bturiaPost\b/);
      expect(f.text, f.path).not.toMatch(/\bfetch\s*\(/);
      expect(f.text, f.path).not.toMatch(/practice\.turia\.in/);
    }
  });

  it("every literal Turia call in read-client.ts is on the allowlist", () => {
    const rc = code.find((f) => f.path === "src/lib/integrations/turia/pull/read-client.ts")!.text;
    const calls = [...rc.matchAll(/readCall\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)].map((m) => [m[1], m[2]] as const);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const [e, a] of calls) expect(isReadAction(e, a), `${e}/${a}`).toBe(true);
    expect(rc).not.toMatch(/\bpost\(\s*"/); // no literal call that skips the gate
  });

  it("calls no Turia adapter write (create client / service / task, close task)", () => {
    for (const f of code) expect(f.text, f.path).not.toMatch(/\.(createClient|addService|createTask|closeTask|confirm)\s*\(/);
  });
});

// Versioned prompts (ADR-008 §8): the lock detects an unversioned edit, a missing version, and
// never rewrites an existing name@version; the committed prompts.lock.json matches the code.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ECHO_RELATED_PARTY_SPEC, echoAgent } from "@/lib/agents/echo";
import { AGENTS } from "@/lib/agents/registry";
import {
  PROMPT_LOCK_FILE,
  currentPrompts,
  emptyPromptLock,
  parsePromptLock,
  promptHash,
  serializePromptLock,
  updatePromptLock,
  verifyPromptLock,
} from "./prompt-lock";
import type { ModelTaskSpec } from "./scope";

const spec = (over: Partial<ModelTaskSpec> = {}): ModelTaskSpec => ({ ...(ECHO_RELATED_PARTY_SPEC as ModelTaskSpec), version: 1, ...over });
const agentsWith = (s: ModelTaskSpec) => ({ echo: { ...echoAgent, scope: { ...echoAgent.scope!, tasks: [s] } } });

describe("promptHash", () => {
  it("is stable, and changes with the prompt, the schema shape, the tier hint or the department", () => {
    const h = promptHash("Books", spec());
    expect(promptHash("Books", spec())).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash("Books", spec({ systemPrompt: `${ECHO_RELATED_PARTY_SPEC.systemPrompt} Be brief.` }))).not.toBe(h);
    expect(promptHash("Books", spec({ schema: z.object({ status: z.enum(["pass", "fail"]) }) }))).not.toBe(h);
    expect(promptHash("Books", spec({ difficulty: "novel" }))).not.toBe(h);
    expect(promptHash("Books", spec({ highStakes: false }))).not.toBe(h);
    expect(promptHash("GST", spec())).not.toBe(h); // the department preamble is part of the prompt
    expect(promptHash("Books", spec({ ruleIds: ["other"] }))).toBe(h); // documentation only
  });
});

describe("verify / update", () => {
  const original = currentPrompts(agentsWith(spec()));
  const lock = updatePromptLock(emptyPromptLock(), original).lock;

  it("a locked, unchanged task passes", () => {
    expect(verifyPromptLock(lock, original)).toMatchObject({ ok: true, problems: [] });
  });
  it("an edited prompt without a version bump fails, and --update refuses to rewrite it", () => {
    const edited = currentPrompts(agentsWith(spec({ systemPrompt: "Answer freely." })));
    const check = verifyPromptLock(lock, edited);
    expect(check.ok).toBe(false);
    expect(check.changed).toEqual(["echo.check:echo.related-party@1"]);
    expect(check.problems[0]).toMatch(/^echo.check:echo.related-party@1: prompt, schema or tier hint changed without a version bump/);
    const u = updatePromptLock(lock, edited);
    expect(u.refused).toEqual(["echo.check:echo.related-party@1"]);
    expect(u.lock.prompts).toEqual(lock.prompts);
  });
  it("a bumped version is missing until --update adds it; the old version stays as history", () => {
    const bumped = currentPrompts(agentsWith(spec({ version: 2, systemPrompt: "Answer from the register only." })));
    expect(verifyPromptLock(lock, bumped)).toMatchObject({ ok: false, missing: ["echo.check:echo.related-party@2"] });
    const u = updatePromptLock(lock, bumped);
    expect(u).toMatchObject({ added: ["echo.check:echo.related-party@2"], refused: [] });
    expect(Object.keys(u.lock.prompts)).toEqual(["echo.check:echo.related-party@1", "echo.check:echo.related-party@2"]);
    expect(verifyPromptLock(u.lock, bumped).ok).toBe(true);
  });
  it("two declarations of one name@version with different prompts are reported", () => {
    const twice = [...original, { ...original[0], agent: "other", hash: "f".repeat(64) }];
    expect(verifyPromptLock(lock, twice)).toMatchObject({ ok: false, duplicates: ["echo.check:echo.related-party@1"] });
  });
  it("parse / serialize round-trip with sorted keys; malformed locks are rejected", () => {
    const text = serializePromptLock(lock);
    expect(parsePromptLock(text)).toEqual(lock);
    expect(text.endsWith("\n")).toBe(true);
    expect(() => parsePromptLock('{"lockVersion":2,"prompts":{}}')).toThrow(/expected/);
    expect(() => parsePromptLock('{"lockVersion":1,"prompts":{"bad key":"x"}}')).toThrow(/bad entry/);
  });
});

describe("the committed lock", () => {
  it(`${PROMPT_LOCK_FILE} matches every scoped agent's tasks (bump the version and run verify-prompts --update otherwise)`, () => {
    const lock = parsePromptLock(readFileSync(PROMPT_LOCK_FILE, "utf8"));
    const check = verifyPromptLock(lock, currentPrompts(AGENTS));
    expect(check.problems).toEqual([]);
    expect(currentPrompts(AGENTS).map((t) => t.agent).sort()).toEqual(expect.arrayContaining(["audit", "books", "echo", "gst", "roc", "tax"]));
  });
});

describe("scripts/verify-prompts.ts (CLI)", () => {
  const TSX = join("node_modules", "tsx", "dist", "cli.mjs");
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [TSX, "scripts/verify-prompts.ts", ...args], { timeout: 120_000 }, (err, stdout, stderr) => {
        resolve({ code: err ? ((err as { code?: number }).code ?? -1) : 0, out: `${stdout}${stderr}` });
      });
    });
  it(
    "missing lock → 1; --update writes it → 0; an unversioned entry → 1 and --update refuses; bad args → 2",
    async () => {
      const lock = join(mkdtempSync(join(tmpdir(), "prompt-lock-")), "prompts.lock.json");
      expect((await cli(`--lock=${lock}`)).code).toBe(1);
      expect((await cli(`--lock=${lock}`, "--update")).code).toBe(0);
      expect((await cli(`--lock=${lock}`)).code).toBe(0);
      const doc = parsePromptLock(readFileSync(lock, "utf8"));
      doc.prompts[`echo.check:echo.related-party@${ECHO_RELATED_PARTY_SPEC.version}`] = "0".repeat(64);
      writeFileSync(lock, serializePromptLock(doc));
      const stale = await cli(`--lock=${lock}`);
      expect(stale.code).toBe(1);
      expect(stale.out).toMatch(/changed without a version bump/);
      expect((await cli(`--lock=${lock}`, "--update")).code).toBe(1);
      expect((await cli("--nope")).code).toBe(2);
    },
    180_000,
  );
});

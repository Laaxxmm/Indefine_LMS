// ADR-009 per-task guardrail profile: docs/ai/guardrail-profiles.md is generated from the task
// registries and must be current; every production task declares what the profile shows
// (documents, privacy, limits); the CLI's --check fails on a stale document.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AGENTS } from "@/lib/agents/registry";
import { PROFILES_DOC, guardrailProfilesMarkdown, schemaSummary, taskProfiles } from "./profiles";
import { abstainable, evidence, groundedNumber, note } from "./schema";
import { taskLabel } from "./scope";

describe("the generated document", () => {
  it(`${PROFILES_DOC} is current (run npx tsx scripts/ai-guardrail-profiles.ts otherwise)`, () => {
    expect(readFileSync(PROFILES_DOC, "utf8").replace(/\r\n/g, "\n")).toBe(guardrailProfilesMarkdown(AGENTS));
  });
  it("lists every declared task once, plus the onboarding extractor", () => {
    const labels = Object.values(AGENTS).flatMap((a) => (a.scope?.tasks ?? []).map(taskLabel));
    const ps = taskProfiles(AGENTS);
    expect(ps.map((p) => p.task)).toEqual([...labels, "onboarding.extract-spec"]);
    const doc = guardrailProfilesMarkdown(AGENTS);
    for (const l of labels) expect(doc).toContain(`### \`${l}\``);
    expect(doc).not.toMatch(/\d{4}-\d{2}-\d{2}T|\b\d{2} [A-Z][a-z]{2} \d{4}\b|\bIST\b/); // no dates: --check is stable
  });
  it("every production task declares its documents, privacy and limits, and meets the LLM01/02/05/06/09/10 controls", () => {
    for (const p of taskProfiles(AGENTS).filter((x) => !x.internal && x.agent !== "onboarding")) {
      expect([p.task, p.documents]).not.toEqual([p.task, "not declared"]);
      expect([p.task, p.privacy]).toEqual([p.task, "anonymize-then-cloud"]);
      expect([p.task, p.limits]).toEqual([p.task, expect.stringMatching(/^input ≤ /)]);
      expect([p.task, p.owasp]).toEqual([p.task, expect.arrayContaining(["LLM01", "LLM02", "LLM05", "LLM06", "LLM09", "LLM10"])]);
      expect(p.output).not.toMatch(/OPEN TEXT/);
    }
  });
  it("the onboarding extractor is shown honestly: fenced and screened, open text by design, no quote grounding", () => {
    const o = taskProfiles(AGENTS).find((p) => p.agent === "onboarding")!;
    expect(o.owasp).toEqual(["LLM01", "LLM02", "LLM03", "LLM06", "LLM07", "LLM10"]);
    expect(o.grounding).toMatch(/^none/);
    expect(o.output).toMatch(/open text fields by design$/);
  });
});

describe("schemaSummary", () => {
  it("describes closed outputs in plain words", () => {
    const s = z.object({ rows: z.array(z.object({ kind: abstainable(z.enum(["a", "b"])), amount: groundedNumber(), evidence: evidence(), note: note().optional() })).max(50) });
    expect(schemaSummary(s)).toBe("{ rows: list (≤ 50) of { kind: a | b or insufficient_evidence; amount: number (must appear in its quote); evidence: quote + location; note?: text ≤ 300 } }");
    expect(schemaSummary(z.object({ x: z.string() }))).toBe("{ x: text (no cap) }");
  });
});

describe("scripts/ai-guardrail-profiles.ts (CLI)", () => {
  const TSX = join("node_modules", "tsx", "dist", "cli.mjs");
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [TSX, "scripts/ai-guardrail-profiles.ts", ...args], { timeout: 120_000 }, (err, stdout, stderr) => {
        resolve({ code: err ? ((err as { code?: number }).code ?? -1) : 0, out: `${stdout}${stderr}` });
      });
    });
  it(
    "writes the document, --check passes on it and fails on a stale one; a bad argument → 2",
    async () => {
      const out = join(mkdtempSync(join(tmpdir(), "profiles-")), "guardrail-profiles.md");
      expect((await cli(`--out=${out}`, "--check")).code).toBe(1); // missing
      expect((await cli(`--out=${out}`)).code).toBe(0);
      expect((await cli(`--out=${out}`, "--check")).code).toBe(0);
      writeFileSync(out, `${readFileSync(out, "utf8")}\nedited by hand\n`);
      const stale = await cli(`--out=${out}`, "--check");
      expect(stale.code).toBe(1);
      expect(stale.out).toMatch(/is out of date — run npx tsx scripts\/ai-guardrail-profiles\.ts/);
      expect((await cli("--nope")).code).toBe(2);
    },
    120_000,
  );
});

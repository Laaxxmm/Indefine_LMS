// CLI self-test of the accuracy gate: `npm run accuracy` exit codes on the perfect echo set and on
// every audit probe (tests/fixtures/accuracy-selftest/), the recorded-mode label, the reserved
// --provider flag, and --write-progress keeping its markers across repeated writes.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCOREBOARD_END, SCOREBOARD_START } from "@/lib/agents/core/accuracy";

const TSX = join("node_modules", "tsx", "dist", "cli.mjs");
const PROBES = "tests/fixtures/accuracy-selftest";

function cli(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [TSX, "scripts/accuracy.ts", ...args], { timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : -1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

describe("npm run accuracy (CLI)", () => {
  it(
    "perfect echo set exits 0; each audit probe exits 1 except the documented one; --provider is reserved",
    async () => {
      const [ok, p1, p2, p3, p4, p5, corrupted, provider, live] = await Promise.all([
        cli("--agent=echo"),
        cli("--agent=echo", `--fixtures=${PROBES}/probe-1-input-amount-plus-1`),
        cli("--agent=echo", `--fixtures=${PROBES}/probe-2-duplicate-ref-input-only`),
        cli("--agent=echo", `--fixtures=${PROBES}/probe-3-recorded-value-changed`),
        cli("--agent=echo", `--fixtures=${PROBES}/probe-4-mistakes-removed`),
        cli("--agent=echo", `--fixtures=${PROBES}/probe-5-llm-quote-not-in-input`),
        cli("--agent=echo", `--fixtures=${PROBES}/corrupted`),
        cli("--agent=echo", "--provider=claude"),
        cli("--agent=echo", "--mode=live"),
      ]);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain("Mode: **recorded**");
      expect(ok.out).toContain("| **echo** | accuracy/echo (9) | **overall** | – | – | – | all of the above | **pass** |");
      expect(ok.out).toContain("| input sensitivity · register.csv (required) | – | – | – | 8/8 changed · need all | pass |");
      expect(ok.out).toContain("| scope violations | – | – | – | 0 · need 0 | pass |");
      expect(ok.out).toContain("| 3× identical (code path) |");

      expect(p1).toMatchObject({ code: 1 });
      expect(p1.out).toContain("clean-register: totalPaise: expected 4745649, got 4745749 (₹1.00 over)");
      expect(p2).toMatchObject({ code: 1 });
      expect(p2.out).toContain("clean-register: unexpected echo.duplicate-refs (block, deterministic)");
      expect(p3).toMatchObject({ code: 0 });
      expect(p3.out).toContain("notes (not gated)");
      expect(p4).toMatchObject({ code: 1 });
      expect(p4.out).toContain("trap-watchlist-mistake: missed echo.watch-shadow (warn, deterministic)");
      expect(p5).toMatchObject({ code: 1 });
      expect(p5.out).toContain("trap-related-party: missed echo.related-party (warn, llm)");
      expect(corrupted).toMatchObject({ code: 1 });
      expect(provider).toMatchObject({ code: 2 });
      expect(provider.out).toContain("reserved for Phase 2b");
      // ADR-008 nightly canary stub: not built until a live key exists.
      expect(live).toMatchObject({ code: 2 });
      expect(live.out).toContain("needs ANTHROPIC_API_KEY / Phase 2b");
    },
    180_000,
  );

  it(
    "--write-progress keeps the start / end markers and replaces the block in place on a second write",
    async () => {
      const out = join(mkdtempSync(join(tmpdir(), "accuracy-cli-")), "PROGRESS.md");
      writeFileSync(out, "# PROGRESS\n\n## Accuracy scoreboard\n_None yet._\n\n## Decisions\n- keep me\n");
      expect((await cli("--agent=echo", "--write-progress", `--out=${out}`)).code).toBe(0);
      expect((await cli("--agent=echo", "--write-progress", `--out=${out}`)).code).toBe(0);
      const doc = readFileSync(out, "utf8");
      expect(doc.split(SCOREBOARD_START)).toHaveLength(2);
      expect(doc.split(SCOREBOARD_END)).toHaveLength(2);
      expect(doc).toContain("## Decisions\n- keep me");
      expect(doc).not.toContain("_None yet._");
    },
    180_000,
  );
});

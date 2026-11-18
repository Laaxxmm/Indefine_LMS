// Re-audit NEW-5 (MEDIUM): AgentRun.error stored a thrown error's message verbatim (up to 2,000
// characters) — a parser that quotes a row, a validator, a provider reply. Ported from the re-audit
// PoC ai-unmask-cache-errors.test.ts part (3): an agent that throws with a person's name, PAN and
// Aadhaar in its message. Now known error classes store a fixed classification, everything else is
// masked (or withheld), zod enum failures never quote the value received, and the run page still
// shows a plain sentence (runFailureMessage). Synthetic values only.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verhoeffCheckDigit } from "@/lib/ai/anonymizer";
import { BudgetExceededError, NoProviderAvailableError, ProviderError } from "@/lib/ai/errors";
import { echoAgent } from "@/lib/agents/echo";
import { InputRejectedError, InputTooLargeError } from "@/lib/agents/core/inputs";
import { RUN_ERROR_WITHHELD, safeDetail, storedRunError, zodIssueText } from "@/lib/agents/core/run-errors";
import { runAgent } from "@/lib/agents/core/runner";
import { ScopeViolationError } from "@/lib/agents/core/guardrails/scope";
import { runFailureMessage, isPlainMessage } from "@/lib/errors";
import { XlsxLimitError } from "@/lib/hardening/xlsx-guard";
import { echoWorld, rows } from "../../fakes/agent-world";

const AADHAAR = "23456789012" + verhoeffCheckDigit("23456789012");
const PAN = "ABCDE1234F";

describe("NEW-5: AgentRun.error never stores client data from a thrown message", () => {
  it("PoC: an agent that throws with a name, PAN and Aadhaar in its message → stored masked", async () => {
    const w = echoWorld();
    const throwing = {
      ...echoAgent,
      async extract() {
        throw new Error(`Row 2: party "Rajesh Kumar" has PAN ${PAN} and Aadhaar ${AADHAAR} (invalid)`);
      },
    };
    const out = await runAgent(throwing as never, "job-1", w.deps, { startedById: "u-priya" });
    expect(out.ok).toBe(false);
    const run = rows(w.db, "agentRun")[0] as { error: string | null };
    for (const s of [PAN, AADHAAR, "Rajesh", "Kumar"]) expect(run.error ?? "", s).not.toContain(s);
    expect(run.error).toMatch(/^Row 2: party "⟨NAME_1⟩" has PAN ⟨PAN_1⟩ and Aadhaar ⟨AADHAAR_1⟩ \(invalid\)$/);
    expect(!out.ok && out.reason).toBe(run.error); // the run API maps this to a sentence (runFailureMessage)
  });

  it("the client's own name (from the job) is masked in a stored error too", async () => {
    const w = echoWorld();
    const throwing = { ...echoAgent, async extract() { throw new Error("ACME Widgets Private Limited register is not balanced"); } };
    await runAgent(throwing as never, "job-1", w.deps);
    const run = rows(w.db, "agentRun")[0] as { error: string | null };
    expect(run.error).not.toMatch(/ACME|Widgets/i);
  });

  it("known classes store a fixed classification; the sentence shown is plain", () => {
    const cases: [unknown, RegExp][] = [
      [new XlsxLimitError("rows", "Sheet Rajesh Kumar Sharma has more than 1,00,000 rows."), /could not be read safely because a sheet has too many rows/],
      [new InputRejectedError("Form16_RAJESH_KUMAR.pdf", "type not accepted"), /One of the input files was refused/],
      [new InputTooLargeError(30 * 1048576, 25 * 1048576), /add up to 30\.0 MB/],
      [new ProviderError("claude", "outage", `upstream said: PAN ${PAN} for Rajesh`, 529), /^provider: Claude unavailable \(529\)$/],
      [new NoProviderAvailableError(`Claude down; Grok said ${PAN}`), /^provider: no AI provider was available$/],
      [new BudgetExceededError("run", 50, 51), /budget/i],
      [new ScopeViolationError('task "echo.undeclared" is not declared'), /^Scope violation/],
    ];
    for (const [err, re] of cases) {
      const stored = storedRunError(err);
      expect(stored, String(err)).toMatch(re);
      for (const s of [PAN, "RAJESH", "Rajesh"]) expect(stored).not.toContain(s);
      expect(isPlainMessage(runFailureMessage(stored)), stored).toBe(true);
    }
  });

  it("zod enum / literal failures never quote the value received", () => {
    const s = z.object({ entity: z.enum(["PVT_LTD", "LLP"]), kind: z.literal("x") });
    const r = s.safeParse({ entity: `Rajesh Kumar ${PAN}`, kind: "Meera" });
    expect(r.success).toBe(false);
    if (r.success) return;
    const texts = r.error.issues.map(zodIssueText);
    expect(texts).toEqual(["entity: must be one of PVT_LTD, LLP", 'kind: must be "x"']);
    const stored = storedRunError(r.error);
    for (const v of [PAN, "Rajesh", "Meera"]) expect(stored).not.toContain(v);
  });

  it("a detail that still looks like client data after masking is withheld whole", () => {
    // Masking keeps the text; an identifier the masker does not know but the detector does would be withheld.
    expect(safeDetail("register.csv row 3: amount \"12ab\" is not a rupee amount")).toBe('register.csv row 3: amount "12ab" is not a rupee amount');
    expect(RUN_ERROR_WITHHELD).not.toMatch(/⟨/);
    expect(isPlainMessage(RUN_ERROR_WITHHELD)).toBe(true);
  });
});

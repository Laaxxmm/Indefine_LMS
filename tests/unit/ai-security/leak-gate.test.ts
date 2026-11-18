// Security finding #3: the router's post-mask leak gate. mask() is replaced by a no-op here to
// simulate a masker regression; the independent detector must then refuse the call (fail closed):
// zero provider calls, a QUEUED_FOR_HUMAN ModelCall row naming the kinds but never the values.
import { describe, expect, it, vi } from "vitest";
import { loadRouterConfig } from "@/lib/ai/config";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";

vi.mock("@/lib/ai/anonymizer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/anonymizer")>();
  return { ...real, mask: (text: string, ctx: { map?: ReturnType<typeof real.createTokenMap> } = {}) => ({ masked: text, map: ctx.map ?? real.createTokenMap() }) };
});

const { createRouter, LEAK_GATE_REASON, leakGateKinds } = await import("@/lib/ai/router");
type Row = { status: string; error: string | null };

function setup() {
  const calls: ProviderRequest[] = [];
  const claude: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      return { output: { output: "ok", confidence: 1 } as T, model: req.model, tokensIn: 1, tokensOut: 1, latencyMs: 1 };
    },
  };
  const off = (id: "grok" | "local"): ModelProvider => ({ id, isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) });
  const rows: Row[] = [];
  const router = createRouter({
    providers: { claude, grok: off("grok"), local: off("local") },
    repo: { record: async (r) => void rows.push(r), costInrSince: async () => 0, costInrForRun: async () => 0 },
    config: loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" }),
  });
  return { router, calls, rows };
}

describe("leak gate: a masked payload in which the independent detector still finds PII is never sent", () => {
  it("masker no-op → call refused, zero provider calls, row names kinds only", async () => {
    const t = setup();
    const res = await t.router.run({
      task: "gst.x",
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      runId: "r",
      dictionary: [{ value: "Zorvan Mandravel", kind: "NAME" }],
      messages: [{ role: "user", content: "PAN ABCDE1234F of Zorvan Mandravel, mob 9876543210, rajesh.k@okhdfcbank" }],
    });
    expect(res).toMatchObject({ status: "queued", reason: LEAK_GATE_REASON });
    expect(t.calls).toHaveLength(0);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].status).toBe("QUEUED_FOR_HUMAN");
    expect(t.rows[0].error).toBe("leak-gate: NAME, PAN, PHONE, UPI found after masking; nothing was sent");
    for (const v of ["ABCDE1234F", "9876543210", "Zorvan", "okhdfcbank"]) expect(t.rows[0].error).not.toContain(v);
  });

  it("re-audit NEW-1: a person's name no dictionary knows (a Form 16 line, a description) is caught by the name-aware gate", async () => {
    const t = setup();
    const res = await t.router.run({
      task: "gst.x",
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      runId: "r",
      messages: [{ role: "user", content: "Name of Employee: RAJESH KUMAR SHARMA\nConsultancy by Yashwanth Gowda Patil for Oct" }],
    });
    expect(res).toMatchObject({ status: "queued", reason: LEAK_GATE_REASON });
    expect(t.calls).toHaveLength(0);
    expect(t.rows[0].error).toBe("leak-gate: NAME found after masking; nothing was sent");
    for (const v of ["RAJESH", "Yashwanth", "Patil"]) expect(t.rows[0].error).not.toContain(v);
    // The system prompt is fixed firm text: capitalised phrases there are not read as names.
    expect(leakGateKinds({ system: "You are the Firm OS Books Agent", messages: [] })).toEqual([]);
  });

  it("local-only work never reaches the gate (and never the cloud)", async () => {
    const t = setup();
    const res = await t.router.run({ task: "gst.x", privacy: "local-only", difficulty: "sop", runId: "r", messages: [{ role: "user", content: "PAN ABCDE1234F" }] });
    expect(res.status).toBe("queued");
    expect(t.calls).toHaveLength(0);
  });

  it("leakGateKinds reads the system prompt and every message, dictionary included", () => {
    expect(leakGateKinds({ system: "PAN ABCDE1234F", messages: [] })).toEqual(["PAN"]);
    expect(leakGateKinds({ system: "Zorvan Mandravel", messages: [] }, [{ value: "Zorvan Mandravel", kind: "NAME" }])).toEqual(["NAME"]);
    expect(leakGateKinds({ system: "x", messages: [{ role: "user", content: "Zorvan Mandravel" }] }, [{ value: "Zorvan Mandravel", kind: "NAME" }])).toEqual(["NAME"]);
    expect(leakGateKinds({ system: "fine", messages: [{ role: "user", content: "⟨PAN_1⟩ fine" }] })).toEqual([]);
  });
});

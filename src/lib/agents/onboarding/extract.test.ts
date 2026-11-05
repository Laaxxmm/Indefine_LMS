import { describe, expect, it, vi } from "vitest";
import { detectPii } from "@/lib/ai/anonymizer";
import { loadRouterConfig } from "@/lib/ai/config";
import { createRouter, type ModelCallRepo, type ModelRequest, type RouterResult } from "@/lib/ai/router";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";
import { EXTRACT_FIXTURES } from "./__fixtures__/extract-fixtures";
import { PAN, PEOPLE, gstinFor } from "./__fixtures__/synthetic";
import { EXTRACT_SYSTEM, EXTRACT_TASK, buildDictionary, extractSpec, type ExtractRouter } from "./extract";
import { ExtractedSpec } from "./spec";

const ok = <T,>(output: T, needsPartnerReview = false): RouterResult<T> => ({
  status: "ok", output, needsPartnerReview, attempts: 1, provider: "claude", model: "m", confidence: 0.9,
  escalated: false, anonymized: true, tokensIn: 10, tokensOut: 10, costInr: 0.01,
});

function mockRouter(result: RouterResult<unknown>) {
  const calls: ModelRequest<unknown>[] = [];
  const router: ExtractRouter = {
    async run<T>(req: ModelRequest<T>) {
      calls.push(req as ModelRequest<unknown>);
      return result as RouterResult<T>;
    },
  };
  return { router, calls };
}

describe("extractor fixtures (router mocked to the fixture's model output)", () => {
  it("has 20 fixtures", () => {
    expect(EXTRACT_FIXTURES).toHaveLength(20);
  });

  for (const f of EXTRACT_FIXTURES) {
    it(f.name, async () => {
      expect(ExtractedSpec.safeParse(f.model).success).toBe(true); // the fixture is a schema-valid model answer
      const { router, calls } = mockRouter(ok(f.model));
      const r = await extractSpec(f.prompt, { router, runId: "run-1", people: PEOPLE });
      expect(r.spec).toEqual(f.expected);
      expect(r.needsReview).toBe(false);
      expect(r.notes).toEqual([]);

      const req = calls[0];
      expect(calls).toHaveLength(1);
      expect(req).toMatchObject({ task: EXTRACT_TASK, privacy: "anonymize-then-cloud", difficulty: "sop", runId: "run-1" });
      expect(req.schema).toBe(ExtractedSpec);
      expect(req.messages).toEqual([{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: f.prompt }]);
      const dict = (req.dictionary ?? []).map((d) => `${d.kind}:${d.value}`);
      expect(dict).toEqual(expect.arrayContaining(["NAME:Priya Sharma", "NAME:Priya", "NAME:Ravi Kumar"]));
      for (const org of f.orgs ?? []) expect(dict).toContain(`ORG:${org}`);
      if (f.ambiguous?.assigneeId !== undefined) expect(r.candidates.assigneeId).toHaveLength(f.ambiguous.assigneeId);
    });
  }
});

describe("extractSpec", () => {
  it("merges a follow-up sentence over the spec so far", async () => {
    const { router } = mockRouter(ok({ clientCode: "acme02", reviewerName: "Anita" }));
    const r = await extractSpec("code ACME02, reviewer Anita", {
      router, runId: "r", people: PEOPLE,
      base: { legalName: "Acme", clientCode: "ACME01", reviewerId: "u-ravi", reviewerName: "Ravi Kumar" },
    });
    expect(r.spec).toEqual({ legalName: "Acme", clientCode: "ACME02", reviewerId: "u-anita", reviewerName: "Anita Desai" });
  });

  it("flags low-confidence answers for review and keeps what was read", async () => {
    const { router } = mockRouter({ ...ok({ legalName: "X Pvt Ltd" }), status: "needs-review", issues: ["low"], needsPartnerReview: true } as RouterResult<unknown>);
    const r = await extractSpec("Onboard X Pvt Ltd", { router, runId: "r" });
    expect(r.needsReview).toBe(true);
    expect(r.spec).toEqual({ legalName: "X Pvt Ltd" });
    expect(r.notes[0]).toMatch(/not confident/);
  });

  it("needs-review with no output gives an empty spec", async () => {
    const { router } = mockRouter({ ...ok(null), status: "needs-review", output: null, issues: [], needsPartnerReview: true } as RouterResult<unknown>);
    expect((await extractSpec("?", { router, runId: "r" })).spec).toEqual({});
  });

  it("passes a router partner-review flag through", async () => {
    const { router } = mockRouter(ok({ legalName: "Y LLP" }, true));
    expect((await extractSpec("Y LLP", { router, runId: "r" })).needsReview).toBe(true);
  });

  it("queued (no model available) falls back to the questions", async () => {
    const { router } = mockRouter({ status: "queued", reason: "local-only", needsPartnerReview: true, runId: "r", attempts: 0 });
    const r = await extractSpec("Onboard Z Pvt Ltd", { router, runId: "r", base: { clientCode: "ZED" } });
    expect(r.spec).toEqual({ clientCode: "ZED" });
    expect(r.notes[0]).toMatch(/Answer the questions/);
  });

  it("a router failure (no key, outage, budget) degrades to the questions and says why", async () => {
    const router: ExtractRouter = { run: vi.fn().mockRejectedValue(new Error("Daily AI budget is exhausted")) };
    const r = await extractSpec("x", { router, runId: "r", base: { clientCode: "ABC" } });
    expect(r.spec).toEqual({ clientCode: "ABC" });
    expect(r.notes).toEqual(["Automatic reading failed (Daily AI budget is exhausted). Answer the questions below instead."]);
    const odd: ExtractRouter = { run: vi.fn().mockRejectedValue("boom") };
    expect((await extractSpec("x", { router: odd, runId: "r" })).notes[0]).toMatch(/\(boom\)/);
  });
});

describe("buildDictionary", () => {
  it("adds full and first names (3+ letters) and company spans, de-duplicated", () => {
    const d = buildDictionary("Onboard Acme Widgets Pvt Ltd and Shah & Co", [...PEOPLE, { id: "x", name: "Al" }]);
    const values = d.map((e) => e.value);
    expect(values).toContain("Acme Widgets Pvt Ltd");
    expect(values).toContain("Shah & Co");
    expect(values).not.toContain("Al");
    expect(values.filter((v) => v === "Priya")).toHaveLength(1);
  });

  it("ignores single capitalised words before a suffix-only match", () => {
    expect(buildDictionary("Limited scope, nothing else", []).filter((e) => e.kind === "ORG")).toEqual([]);
  });
});

describe("through the real ModelRouter (masking end to end)", () => {
  it("sends no PAN, GSTIN, phone, email, staff or company name to the provider and unmasks the answer", async () => {
    const gstin = gstinFor("29", PAN.company);
    const prompt = `Onboard Acme Widgets Private Limited, PAN ${PAN.company}, GSTIN ${gstin}, contact meera@acme.test 9876543210, GST monthly, assign Priya Sharma, reviewer Ravi Kumar.`;
    const payloads: ProviderRequest[] = [];
    const token = (text: string, kind: string) => text.match(new RegExp(`⟨${kind}_\\d+⟩`))?.[0] ?? null;
    const claude: ModelProvider = {
      id: "claude",
      isAvailable: async () => true,
      async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
        payloads.push(req);
        const user = req.messages[0].content;
        const names = user.match(/⟨NAME_\d+⟩/g) ?? [];
        const output = {
          legalName: token(user, "ORG"), entityType: "PVT_LTD", pan: token(user, "PAN"), gstins: [token(user, "GSTIN")],
          contactEmail: token(user, "EMAIL"), contactPhone: token(user, "PHONE"), services: [{ service: "GST", frequency: "MONTHLY" }],
          assigneeName: names[0], reviewerName: names[1],
        };
        return { output: { output, confidence: 0.95 } as T, model: req.model, tokensIn: 100, tokensOut: 50, latencyMs: 5 };
      },
    };
    const off: ModelProvider = { id: "local", isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) };
    const repo: ModelCallRepo = { record: async () => {}, costInrSince: async () => 0, costInrForRun: async () => 0 };
    const router = createRouter({ providers: { claude, grok: { ...off, id: "grok" }, local: off }, repo, config: loadRouterConfig({}) });

    const r = await extractSpec(prompt, { router, runId: "run-e2e", people: PEOPLE });
    const sent = JSON.stringify(payloads);
    for (const raw of [PAN.company, gstin, "meera@acme.test", "9876543210", "Priya Sharma", "Ravi Kumar", "Acme Widgets Private Limited"]) {
      expect(sent).not.toContain(raw);
    }
    expect(detectPii(payloads[0].messages[0].content)).toEqual([]);
    expect(r.spec).toMatchObject({
      legalName: "Acme Widgets Private Limited", pan: PAN.company, gstins: [gstin], contactEmail: "meera@acme.test", contactPhone: "9876543210",
      assigneeId: "u-priya", reviewerId: "u-ravi",
    });
  });
});

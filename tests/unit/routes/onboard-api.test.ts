// /api/firm-os/onboard/* route handlers: auth → zod → one service call → JSON.
import { beforeEach, describe, expect, it, vi } from "vitest";
// These routes sit behind the Firm OS master switch (src/lib/workspace/flag.ts); it is on for these tests.
beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));
import { activeSession } from "./harness";

const svc = {
  start: vi.fn(async () => ({ id: "run-1", status: "DRAFT" })),
  answer: vi.fn(async () => ({ id: "run-1" })),
  plan: vi.fn(async () => ({ id: "run-1" })),
  create: vi.fn(async () => ({ id: "run-1", status: "DONE" })),
  resume: vi.fn(async () => ({ id: "run-1" })),
  turiaConfirm: vi.fn(async () => ({ id: "run-1" })),
  get: vi.fn(),
};
const factory = vi.fn((_opts?: unknown) => svc);

// Route-level AuditEvents (src/lib/audit/record.ts) and the rate-limit bucket
// (src/lib/hardening/rate-limit.ts) go through the app's Prisma client.
const audits = vi.hoisted(() => [] as { data: Record<string, unknown> }[]);
const bucket = vi.hoisted(() => ({ count: 1, windowStart: new Date() }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/agents/onboarding/defaults", () => ({ onboardingService: (opts?: unknown) => factory(opts) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: async (a: { data: Record<string, unknown> }) => (audits.push(a), { id: `audit-${audits.length}` }) },
    // The bucket upsert: the count after this request (1 unless a test says otherwise).
    $queryRaw: async () => [{ count: bucket.count, windowStart: bucket.windowStart }],
  },
}));

const { auth } = await import("@/lib/auth");
const { OnboardingError } = await import("@/lib/agents/onboarding/service");
const { SagaError } = await import("@/lib/agents/onboarding/saga");
const { TuriaConfirmError } = await import("@/lib/integrations/turia/errors");
const { BudgetExceededError } = await import("@/lib/ai/errors");
const routes = {
  start: (await import("@/app/api/firm-os/onboard/start/route")).POST,
  answer: (await import("@/app/api/firm-os/onboard/answer/route")).POST,
  plan: (await import("@/app/api/firm-os/onboard/plan/route")).POST,
  create: (await import("@/app/api/firm-os/onboard/create/route")).POST,
  resume: (await import("@/app/api/firm-os/onboard/resume/route")).POST,
  "turia-confirm": (await import("@/app/api/firm-os/onboard/turia-confirm/route")).POST,
};
type Route = keyof typeof routes;

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const partner = () => activeSession({ id: "u-partner", level: "PARTNER" });
const req = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

const VALID: Record<Route, unknown> = {
  start: { prompt: "Onboard Acme Pvt Ltd, GST monthly" },
  answer: { runId: "run-1", answers: { pan: "AAACA1234F", services: ["GST:MONTHLY"] } },
  plan: { runId: "run-1" },
  create: { runId: "run-1" },
  resume: { runId: "run-1" },
  "turia-confirm": { runId: "run-1", syncId: "s-1", turiaRef: "TUR-1", minutes: 30 },
};

describe("/api/firm-os/onboard — access", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const name of Object.keys(routes) as Route[]) {
    it(`${name}: 401 signed out, 403 for staff and inactive partners, no service call`, async () => {
      signedIn(null);
      expect((await routes[name](req(VALID[name]))).status).toBe(401);
      signedIn(activeSession()); // EXECUTIVE = staff
      const r = await routes[name](req(VALID[name]));
      expect(r.status).toBe(403);
      expect((await r.json()).error).toMatch(/partners and managers/);
      signedIn(activeSession({ level: "ASSISTANT_MANAGER" }));
      expect((await routes[name](req(VALID[name]))).status).toBe(403);
      signedIn(activeSession({ level: "PARTNER", active: false }));
      expect((await routes[name](req(VALID[name]))).status).toBe(403);
      expect(factory).not.toHaveBeenCalled();
    });
  }
});

describe("/api/firm-os/onboard — validation (400)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn(partner());
  });

  it.each<[Route, unknown, RegExp]>([
    ["start", "not json", /Some details were missing or not in the right format/],
    ["start", { prompt: "hi" }, /Describe the client/],
    ["start", { prompt: "x".repeat(2001) }, /2,000/],
    ["answer", { runId: "run-1" }, /Answer at least one question/],
    ["answer", { runId: "run-1", answers: {} }, /Answer at least one question/],
    ["answer", { runId: "", answers: { pan: "X" } }, /./],
    ["answer", { runId: "run-1", answers: { pan: 5 } }, /./],
    ["plan", {}, /Some details were missing or not in the right format/],
    ["create", { runId: "x".repeat(65) }, /./],
    ["resume", null, /./],
    ["turia-confirm", { runId: "run-1", syncId: "s-1", turiaRef: "  " }, /Enter the Turia reference/],
    ["turia-confirm", { runId: "run-1", syncId: "s-1", turiaRef: "R", minutes: 1.5 }, /./],
    ["turia-confirm", { runId: "run-1", syncId: "s-1", turiaRef: "R", minutes: 0 }, /./],
  ])("%s rejects %j", async (name, body, msg) => {
    const r = await routes[name](req(body));
    expect(r.status).toBe(400);
    const { error } = await r.json();
    expect(error).toMatch(msg);
    // Zod's own wording ("Required", "Expected string…", "Invalid input") never reaches a person.
    expect(error).not.toMatch(/^(?:Required|Expected|Invalid)\b/);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("/api/firm-os/onboard — happy path and errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn(partner());
  });

  it("each route makes exactly one service call with the actor and returns { run }", async () => {
    let r = await routes.start(req(VALID.start));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ run: { id: "run-1", status: "DRAFT" } });
    expect(svc.start).toHaveBeenCalledWith("Onboard Acme Pvt Ltd, GST monthly", "u-partner");
    expect(factory).toHaveBeenCalledWith({ actorIsPartner: true, viewer: expect.objectContaining({ id: expect.any(String) }) }); // the viewer gates every step on an existing run (creator or partner)

    r = await routes.answer(req({ runId: "run-1", message: "reviewer Anita" }));
    expect(r.status).toBe(200);
    expect(svc.answer).toHaveBeenCalledWith("run-1", { answers: undefined, message: "reviewer Anita" });
    for (const name of ["plan", "create", "resume"] as const) {
      expect((await routes[name](req(VALID[name]))).status).toBe(200);
      expect(svc[name]).toHaveBeenCalledWith("run-1", "u-partner");
    }
    expect((await routes["turia-confirm"](req(VALID["turia-confirm"]))).status).toBe(200);
    expect(svc.turiaConfirm).toHaveBeenCalledWith("run-1", { syncId: "s-1", turiaRef: "TUR-1", minutes: 30 }, "u-partner");
  });

  it("start, answer, plan and resume each write an AuditEvent; answers are recorded by field name only (create and Turia confirm audit in the service)", async () => {
    audits.length = 0;
    await routes.start(req(VALID.start));
    await routes.answer(req(VALID.answer));
    await routes.plan(req(VALID.plan));
    await routes.resume(req(VALID.resume));
    await routes.create(req(VALID.create));
    expect(audits.map((a) => a.data.action)).toEqual(["onboarding.start", "onboarding.answer", "onboarding.plan", "onboarding.resume"]);
    for (const a of audits) expect(a.data).toMatchObject({ actorId: "u-partner", entity: "OnboardingRun", entityId: "run-1" });
    expect(audits[1].data.meta).toEqual({ fields: ["pan", "services"], message: false });
    expect(JSON.stringify(audits)).not.toContain("AAACA1234F"); // the PAN itself never reaches the audit trail
  });

  it("rate limit: the 31st onboarding request in the window gets 429 with Retry-After and no service call; Turia confirm is not limited", async () => {
    bucket.count = 31;
    bucket.windowStart = new Date(Date.now() - 20 * 60_000); // 20 minutes into the hour
    const r = await routes.start(req(VALID.start));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(39 * 60);
    expect(Number(r.headers.get("Retry-After"))).toBeLessThanOrEqual(40 * 60);
    expect(r.headers.get("RateLimit-Limit")).toBe("30");
    expect((await r.json()).error).toMatch(/You have made too many onboarding requests in an hour \(the limit is 30\)\. Wait 40 minutes, then try again\./);
    expect(svc.start).not.toHaveBeenCalled();
    for (const name of ["answer", "plan", "create", "resume"] as const) expect((await routes[name](req(VALID[name]))).status).toBe(429);
    expect((await routes["turia-confirm"](req(VALID["turia-confirm"]))).status).toBe(200);
    bucket.count = 1;
  });

  it("writes no AuditEvent when the service call fails", async () => {
    audits.length = 0;
    svc.start.mockRejectedValueOnce(new OnboardingError("invalid", "nope"));
    expect((await routes.start(req(VALID.start))).status).toBe(400);
    expect(audits).toEqual([]);
  });

  it("managers and admins may onboard too (not as partner)", async () => {
    signedIn(activeSession({ level: "MANAGER" }));
    expect((await routes.plan(req(VALID.plan))).status).toBe(200);
    expect(factory).toHaveBeenLastCalledWith({ actorIsPartner: false, viewer: expect.objectContaining({ id: expect.any(String) }) });
    signedIn(activeSession({ role: "ADMIN" }));
    expect((await routes.plan(req(VALID.plan))).status).toBe(200);
  });

  it.each<[unknown, number]>([
    [new OnboardingError("not-found", "gone"), 404],
    [new OnboardingError("conflict", "confirmed"), 409],
    [new OnboardingError("invalid", "answer first"), 400],
    [new SagaError("busy", "running"), 409],
    [new SagaError("not-confirmed", "draft"), 409],
    [new SagaError("not-found", "gone"), 404],
    [new TuriaConfirmError("conflict", "other ref"), 409],
    [new TuriaConfirmError("invalid", "minutes"), 400],
    [new BudgetExceededError("day", 1000, 1000), 503],
  ])("maps %s to %i", async (err, status) => {
    svc.create.mockRejectedValueOnce(err);
    const r = await routes.create(req(VALID.create));
    expect(r.status).toBe(status);
    expect((await r.json()).error).toBeTruthy();
  });

  it("unknown errors are not swallowed", async () => {
    svc.resume.mockRejectedValueOnce(new Error("db down"));
    await expect(routes.resume(req(VALID.resume))).rejects.toThrow("db down");
    for (const name of ["start", "answer", "plan", "turia-confirm"] as const) {
      const fn = name === "turia-confirm" ? svc.turiaConfirm : svc[name];
      fn.mockRejectedValueOnce(new OnboardingError("not-found", "x"));
      expect((await routes[name](req(VALID[name]))).status).toBe(404);
    }
  });
});

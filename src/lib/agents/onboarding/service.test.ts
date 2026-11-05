import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import type { RouterResult } from "@/lib/ai/router";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { FakeTuriaRepo } from "../../../../tests/fakes/fake-turia-repo";
import { MemoryOnboardingStore } from "../../../../tests/fakes/fake-onboarding-store";
import { PAN, PEOPLE, completeSpec, gstinFor } from "./__fixtures__/synthetic";
import type { ExtractRouter } from "./extract";
import { createCalendarPlanner } from "./planner";
import { createSaga } from "./saga";
import { OnboardingError, RUN_NOT_YOURS, createOnboardingService } from "./service";
import type { ExtractedSpec } from "./spec";
import type { ValidationPorts } from "./validators";
import type { OnboardingSubject } from "./restriction";
import type { SessionUser } from "@/lib/access";

const NOW = new Date("2026-11-05T10:00:00Z");

function routerReturning(...outputs: ExtractedSpec[]): ExtractRouter {
  return {
    async run<T>() {
      const output = outputs.shift() ?? {};
      return { status: "ok", output, needsPartnerReview: false, attempts: 1, provider: "claude", model: "m", confidence: 0.9, escalated: false, anonymized: true, tokensIn: 1, tokensOut: 1, costInr: 0 } as RouterResult<T>;
    },
  };
}

function setup(o: { confirmRequired?: boolean; outputs?: ExtractedSpec[]; ports?: Partial<ValidationPorts>; aiRestricted?: (s: OnboardingSubject) => Promise<boolean>; viewer?: SessionUser | null } = {}) {
  const store = new MemoryOnboardingStore(PEOPLE);
  const repo = new FakeTuriaRepo();
  const manual = new ManualBridge(repo, () => NOW);
  const firmClients = store.firmClients;
  const ports: ValidationPorts = {
    findFirmClientByCode: async (code) => {
      const f = firmClients.find((x) => x.clientCode === code);
      return f ? { lmsClientId: f.lmsClientId, legalName: store.clients.find((c) => c.id === f.lmsClientId)!.name } : null;
    },
    findLmsClient: async () => null,
    findActiveUser: async (id) => PEOPLE.find((p) => p.id === id) ?? null,
    turia: manual,
    ...o.ports,
  };
  const sharepoint = {
    ensureClientSite: vi.fn(async (code: string) => ({ siteUrl: `https://srcaassociate.sharepoint.com/sites/CL-${code}`, created: ["site"] })),
    ensureFyTree: vi.fn(async () => ({ siteUrl: "s", folders: 10, created: [] })),
  };
  const turiaRefs = new Map<string, string>();
  const audits: string[] = [];
  const deps: Parameters<typeof createOnboardingService>[0] = {
    runs: store,
    router: routerReturning(...(o.outputs ?? [])),
    people: async () => PEOPLE,
    ports,
    planner: createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "Statutory calendar: defaults" }) }),
    saga: createSaga({ store, turia: manual, sharepoint, now: () => NOW }),
    turiaMode: "MANUAL",
    confirmRequired: o.confirmRequired ?? true,
    manual,
    listTuriaSyncs: async (fc) => repo.rows.filter((r) => r.firmClientId === fc),
    getTuriaSync: (id) => repo.get(id),
    setTuriaClientRef: async (fc, ref) => void turiaRefs.set(fc, ref),
    audit: async (e) => void audits.push(e.action),
    aiRestricted: o.aiRestricted ?? (async () => false),
    viewer: o.viewer ?? null,
    now: () => NOW,
  };
  const service = createOnboardingService(deps);
  /** The same world, acted on by someone else. */
  const as = (viewer: SessionUser | null) => createOnboardingService({ ...deps, viewer });
  return { service, store, repo, sharepoint, turiaRefs, audits, as };
}

const FULL_ANSWERS = (() => {
  const s = completeSpec();
  return {
    clientCode: s.clientCode, pan: s.pan, gstins: s.gstins.join("\n"), cin: s.cin!, firstPeriod: s.firstPeriod!, fy: s.fy,
    contactName: s.contactName, contactEmail: s.contactEmail, contactPhone: s.contactPhone, turnoverInr: "2.5 Cr",
    billing: s.billing, dscHolder: s.dscHolder!, booksSoftware: "Tally",
  };
})();

describe("onboarding service — conversation", () => {
  it("start: extracts, resolves people and asks only what is missing (≤ 5)", async () => {
    const { service, store } = setup({
      outputs: [{ legalName: "Acme Widgets Private Limited", entityType: "PVT_LTD", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC" }, { service: "Books", frequency: "MONTHLY" }], assigneeName: "Priya Sharma", reviewerName: "Ravi" }],
    });
    const v = await service.start("Onboard Acme Widgets Private Limited …", "u-partner");
    expect(v.status).toBe("DRAFT");
    expect(v.spec).toMatchObject({ assigneeId: "u-priya", reviewerId: "u-ravi" });
    expect(v.questions.map((q) => q.field)).toEqual(["clientCode", "fy", "pan", "gstins", "cin"]);
    expect(v.complete).toBe(false);
    expect(store.runs.get(v.id)!.prompt).toMatch(/Onboard Acme/);
  });

  it("answer: merges answers, re-validates, and re-asks invalid values with the reason", async () => {
    const { service } = setup({ outputs: [{ legalName: "Acme Widgets Private Limited", entityType: "PVT_LTD", services: [{ service: "GST", frequency: "MONTHLY" }], assigneeName: "Priya Sharma", reviewerName: "Ravi" }] });
    const v0 = await service.start("x", "u");
    const v1 = await service.answer(v0.id, { answers: { ...FULL_ANSWERS, gstins: gstinFor("29", PAN.company2), turnoverInr: "lots" } });
    const gstQ = v1.questions.find((q) => q.field === "gstins");
    expect(gstQ?.error).toMatch(/belongs to PAN AAACB5678K/);
    expect(v1.questions.find((q) => q.field === "turnoverInr")?.error).toMatch(/Enter an amount/);
    const v2 = await service.answer(v0.id, { answers: { gstins: FULL_ANSWERS.gstins, turnoverInr: "2.5 Cr" } });
    expect(v2.questions).toEqual([]);
    expect(v2.complete).toBe(true);
    expect(v2.checks[0]).toMatch(/Search Turia .* ACME01/);
  });

  it("answer with a follow-up sentence runs the extractor over the spec so far", async () => {
    const { service } = setup({ outputs: [{ legalName: "Acme" }, { clientCode: "acme9" }] });
    const v0 = await service.start("Onboard Acme", "u");
    const v1 = await service.answer(v0.id, { message: "code is acme9" });
    expect(v1.spec).toMatchObject({ legalName: "Acme", clientCode: "ACME9" });
  });

  it("errors that are not this turn's questions are listed separately", async () => {
    const { service } = setup({ outputs: [{ ...completeSpec({ entityType: "PROPRIETORSHIP", pan: PAN.individual, gstins: [gstinFor("29", PAN.individual)] }), cin: "U12345KA2020PTC123456", services: [{ service: "GST", frequency: "MONTHLY" }] }] });
    const v = await service.start("x", "u");
    expect(v.errors.map((e) => e.message)).toContain("A proprietorship has no CIN/LLPIN");
    expect(v.complete).toBe(false);
  });

  it("refuses to plan while questions remain, and unknown runs", async () => {
    const { service } = setup({ outputs: [{ legalName: "Acme" }] });
    const v = await service.start("x", "u");
    await expect(service.plan(v.id, "u")).rejects.toMatchObject({ code: "invalid" });
    await expect(service.get("nope")).rejects.toBeInstanceOf(OnboardingError);
  });
});

async function planned(o: Parameters<typeof setup>[0] = {}) {
  const ctx = setup({ outputs: [{ legalName: "Acme Widgets Private Limited", entityType: "PVT_LTD", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC" }, { service: "Books", frequency: "MONTHLY" }], assigneeName: "Priya Sharma", reviewerName: "Ravi" }], ...o });
  const v0 = await ctx.service.start("x", "u-partner");
  await ctx.service.answer(v0.id, { answers: FULL_ANSWERS });
  const v = await ctx.service.plan(v0.id, "u-partner");
  return { ...ctx, v, runId: v0.id };
}

describe("onboarding service — plan, create, resume, Turia confirm", () => {
  it("plan preview lists everything and waits for Create", async () => {
    const { v, store } = await planned();
    expect(v.status).toBe("DRAFT");
    expect(v.plan).toMatchObject({ clientCode: "ACME01", confirmRequired: true, lmsClient: { action: "create" }, plannerSource: "Statutory calendar: defaults" });
    expect(v.plan!.people).toEqual({ assignee: { id: "u-priya", name: "Priya Sharma" }, reviewer: { id: "u-ravi", name: "Ravi Kumar" } });
    expect(v.plan!.jobs.length).toBeGreaterThan(10);
    expect(store.clients).toHaveLength(0); // nothing written before Create
  });

  it("create runs the saga; Done in Turia stores the client ref and settles the step", async () => {
    const { service, runId, store, repo, turiaRefs, audits } = await planned();
    const v = await service.create(runId, "u-partner");
    expect(v.status).toBe("DONE");
    expect(store.jobTasks.length).toBe(v.plan!.jobs.length);
    expect(v.turia.map((t) => t.operation)).toEqual(["createClient", "addService", "addService", "addService", ...Array(v.plan!.turia.tasksNow).fill("createTask")]);
    expect(v.turia[0].checklist?.steps.length).toBeGreaterThan(3);
    expect(audits).toContain("onboarding.confirm");

    const createClient = repo.rows[0];
    const after = await service.turiaConfirm(runId, { syncId: createClient.id, turiaRef: "TUR-CL-1" }, "u-staff");
    expect(turiaRefs.get(store.firmClients[0].id)).toBe("TUR-CL-1");
    expect(after.turia[0]).toMatchObject({ status: "CONFIRMED", turiaRef: "TUR-CL-1" });
    expect(after.steps!.find((s) => s.key === "turia")!.status).toBe("waiting");
    for (const r of repo.rows.slice(1)) await service.turiaConfirm(runId, { syncId: r.id, turiaRef: `R-${r.id}` }, "u-staff");
    const done = await service.get(runId);
    expect(done.steps!.filter((s) => s.status !== "done")).toEqual([]);
    expect(audits.filter((a) => a === "turia.confirm")).toHaveLength(repo.rows.length);
    expect(done.questions).toEqual([]); // no questions once confirmed
  });

  it("turiaConfirm refuses a sync from another client and an unconfirmed run", async () => {
    const { service, runId, repo } = await planned();
    await expect(service.turiaConfirm(runId, { syncId: "sync-x", turiaRef: "R" }, "u")).rejects.toMatchObject({ code: "not-found" });
    await service.create(runId, "u");
    repo.rows[0].firmClientId = "other";
    await expect(service.turiaConfirm(runId, { syncId: repo.rows[0].id, turiaRef: "R" }, "u")).rejects.toMatchObject({ code: "not-found" });
  });

  it("resume continues a failed run; resume of a draft and answer after confirm are refused", async () => {
    const { service, runId, store, sharepoint } = await planned();
    await expect(service.resume(runId, "u")).rejects.toMatchObject({ code: "conflict" });
    sharepoint.ensureFyTree.mockRejectedValueOnce(new Error("Graph 503"));
    const failed = await service.create(runId, "u");
    expect(failed.status).toBe("FAILED");
    expect(failed.steps!.find((s) => s.key === "sharepoint")!.status).toBe("failed");
    const ok = await service.resume(runId, "u");
    expect(ok.status).toBe("DONE");
    expect(store.clients).toHaveLength(1);
    await expect(service.answer(runId, { answers: {} })).rejects.toMatchObject({ code: "conflict" });
    await expect(service.plan(runId, "u")).rejects.toMatchObject({ code: "conflict" });
  });

  it("create needs a plan", async () => {
    const { service } = setup({ outputs: [{ legalName: "Acme" }] });
    const v = await service.start("x", "u");
    await expect(service.create(v.id, "u")).rejects.toMatchObject({ code: "invalid" });
  });

  it("answers after planning make the plan stale (cleared)", async () => {
    const { service, runId } = await planned();
    const v = await service.answer(runId, { answers: { billing: "Per filing" } });
    expect(v.plan).toBeNull();
  });

  it("FIRM_OS_ONBOARD_CONFIRM=false: planning executes straight away", async () => {
    const { v, store } = await planned({ confirmRequired: false });
    expect(v.status).toBe("DONE");
    expect(v.confirmRequired).toBe(false);
    expect(store.firmClients).toHaveLength(1);
  });
});

describe("onboarding service — DPDP restriction (no AI processing for a restricted client)", () => {
  const RESTRICTED_PAN = PAN.individual;
  const restrictedFor = (pan: string) => {
    const asked: OnboardingSubject[] = [];
    return { asked, check: async (s: OnboardingSubject) => (asked.push(s), JSON.stringify(s).includes(pan)) };
  };

  it("start: a sentence naming a restricted client's PAN is refused before any run is written or any model call", async () => {
    const r = restrictedFor(RESTRICTED_PAN);
    const { service, store } = setup({ aiRestricted: r.check, outputs: [{ legalName: "should not be read" }] });
    await expect(service.start(`Onboard Meena Stores, PAN ${RESTRICTED_PAN}, GST monthly`, "u-partner")).rejects.toMatchObject({
      code: "restricted",
      message: "This client has restricted AI processing. Prepare this by hand or ask a partner to lift the restriction.",
    });
    expect(store.runs.size).toBe(0);
    expect(r.asked).toEqual([{ text: `Onboard Meena Stores, PAN ${RESTRICTED_PAN}, GST monthly` }]);
  });

  it("answer: a follow-up sentence is refused (spec and run unchanged) once the spec names a restricted client; form answers alone never reach a model and are accepted", async () => {
    const r = restrictedFor(RESTRICTED_PAN);
    const { service, store } = setup({ aiRestricted: r.check, outputs: [{ legalName: "Meena Stores" }, { clientCode: "MEENA1" }] });
    const v0 = await service.start("Onboard Meena Stores", "u-partner");
    const v1 = await service.answer(v0.id, { answers: { pan: RESTRICTED_PAN } }); // typed by hand: no model call, no check
    expect(v1.spec.pan).toBe(RESTRICTED_PAN);
    const before = structuredClone(store.runs.get(v0.id));
    await expect(service.answer(v0.id, { message: "code is meena1" })).rejects.toMatchObject({ code: "restricted" });
    expect(store.runs.get(v0.id)).toEqual(before);
    // Identifiers typed in the same turn as a sentence are checked too.
    const fresh = setup({ aiRestricted: r.check, outputs: [{ legalName: "Xavier Stores" }] });
    const f0 = await fresh.service.start("Onboard X", "u");
    await expect(fresh.service.answer(f0.id, { message: "GST monthly", answers: { pan: RESTRICTED_PAN } })).rejects.toMatchObject({ code: "restricted" });
    expect(fresh.store.runs.get(f0.id)!.spec).not.toHaveProperty("pan");
  });

  it("a new client (no restriction) is read as before", async () => {
    const { service } = setup({ aiRestricted: async () => false, outputs: [{ legalName: "Acme" }] });
    expect((await service.start("Onboard Acme", "u")).spec).toMatchObject({ legalName: "Acme" });
  });
});

describe("onboarding service — only the creator or a partner may open a run (security audit finding C)", () => {
  const person = (id: string, over: Partial<NonNullable<SessionUser>> = {}) =>
    ({ id, name: id, email: `${id}@indefine.test`, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "MANAGER", ...over }) as NonNullable<SessionUser>;
  const creator = person("u-mgr-a");
  const otherManager = person("u-mgr-b");
  const admin = person("u-admin", { role: "ADMIN", level: "EXECUTIVE" });
  const partner = person("u-partner", { level: "PARTNER" });

  it("another manager or an admin gets 'not found' for answer, plan, create, resume, Turia confirm and get; nothing changes", async () => {
    const ctx = setup({ viewer: creator, outputs: [{ legalName: "Acme Widgets Private Limited" }] });
    const v0 = await ctx.service.start("Onboard Acme Widgets Private Limited", creator.id);
    const before = structuredClone(ctx.store.runs.get(v0.id));
    for (const viewer of [otherManager, admin]) {
      const svc = ctx.as(viewer);
      const calls: Array<() => Promise<unknown>> = [
        () => svc.get(v0.id),
        () => svc.answer(v0.id, { answers: { clientCode: "ACME01" } }),
        () => svc.plan(v0.id, viewer.id),
        () => svc.create(v0.id, viewer.id),
        () => svc.resume(v0.id, viewer.id),
        () => svc.turiaConfirm(v0.id, { syncId: "s1", turiaRef: "T-1" }, viewer.id),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "not-found", message: RUN_NOT_YOURS });
    }
    expect(ctx.store.runs.get(v0.id)).toEqual(before);
  });

  it("the creator and any partner (admin-partners too) may continue it; inactive people may not", async () => {
    const ctx = setup({ viewer: creator, outputs: [{ legalName: "Acme Widgets Private Limited" }] });
    const v0 = await ctx.service.start("Onboard Acme Widgets Private Limited", creator.id);
    expect((await ctx.service.get(v0.id)).id).toBe(v0.id);
    expect((await ctx.as(partner).answer(v0.id, { answers: { clientCode: "ACME01" } })).spec.clientCode).toBe("ACME01");
    expect((await ctx.as(person("u-ap", { role: "ADMIN", level: "PARTNER" })).get(v0.id)).id).toBe(v0.id);
    await expect(ctx.as(person("u-mgr-a", { active: false })).get(v0.id)).rejects.toMatchObject({ code: "not-found" });
  });
});

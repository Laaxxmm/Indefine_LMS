import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DEFAULT_CALENDAR, defaultCalendarJson } from "@/lib/agents/core";
import { PEOPLE, completeSpec } from "./__fixtures__/synthetic";
import {
  clientBodyFromSpec, listPeople, loadCalendarPack, prismaRunStore, prismaSagaStore, prismaValidationPorts, setTuriaClientRef, toRunRecord,
} from "./db";
import type { OnboardingPlan } from "./plan";

const NOW = new Date("2026-11-05T10:00:00Z");
const p2002 = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" });

const runRow = (o: Record<string, unknown> = {}) => ({
  id: "run-1", createdById: "u", prompt: "p", spec: { legalName: "A" }, plan: null, status: "DRAFT", steps: null, error: null, firmClientId: null,
  createdAt: NOW, updatedAt: NOW, ...o,
});

function db(over: Record<string, Record<string, unknown>> = {}) {
  const base = {
    onboardingRun: { create: vi.fn(async ({ data }) => runRow(data)), findUnique: vi.fn(async () => runRow()), update: vi.fn(async ({ data }) => runRow(data)), updateMany: vi.fn(async () => ({ count: 1 })) },
    user: { findMany: vi.fn(async () => [{ id: "u1", name: null, email: "a@x" }, { id: "u2", name: "B", email: "b@x" }]), findFirst: vi.fn(async () => ({ id: "u1", name: null, email: "a@x" })) },
    firmClient: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: "fc-1", ...data })), update: vi.fn(async () => ({})) },
    client: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "c-new", jobs: [] })) },
    engagement: { upsert: vi.fn(async ({ create }) => ({ id: `eng-${create.service}` })) },
    jobTask: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn(async () => ({})) },
    sopPack: { findMany: vi.fn(async () => []) },
  };
  for (const [k, v] of Object.entries(over)) Object.assign((base as Record<string, Record<string, unknown>>)[k], v);
  const client = { ...base, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)) };
  return client as unknown as MockDb;
}

type MockFn = ReturnType<typeof vi.fn>;
type MockDb = Record<string, Record<string, MockFn>> & { $transaction: MockFn };

const plan = (o: Partial<OnboardingPlan> = {}) => ({ lmsClient: { action: "create" }, ...o }) as OnboardingPlan;

describe("run store", () => {
  it("creates, reads and updates OnboardingRun rows", async () => {
    const d = db();
    const store = prismaRunStore(d as never);
    expect((await store.create({ createdById: "u", prompt: "p", spec: {} })).status).toBe("DRAFT");
    expect(d.onboardingRun.create).toHaveBeenCalledWith({ data: { createdById: "u", prompt: "p", spec: {}, status: "DRAFT" } });
    expect((await store.get("run-1"))?.spec).toEqual({ legalName: "A" });
    d.onboardingRun.findUnique.mockResolvedValueOnce(null as never);
    expect(await store.get("x")).toBeNull();
    await store.update("run-1", { spec: { legalName: "B" }, plan: null, status: "CONFIRMED", steps: [] });
    expect(d.onboardingRun.update.mock.calls[0][0].data).toEqual({ spec: { legalName: "B" }, plan: Prisma.DbNull, status: "CONFIRMED", steps: [] });
    await store.update("run-1", { plan: { version: 1 } as OnboardingPlan });
    expect(d.onboardingRun.update.mock.calls[1][0].data).toEqual({ plan: { version: 1 } });
    expect(toRunRecord(runRow({ spec: null }) as never).spec).toEqual({});
  });
});

describe("people and validation ports", () => {
  it("lists active real people, falling back to email", async () => {
    expect(await listPeople(db() as never)).toEqual([{ id: "u1", name: "a@x" }, { id: "u2", name: "B" }]);
  });

  it("looks up codes, LMS clients and active users", async () => {
    const d = db({
      firmClient: { findUnique: vi.fn().mockResolvedValueOnce({ lmsClientId: "c1", client: { name: "Acme" } }).mockResolvedValueOnce(null) },
      client: { findFirst: vi.fn().mockResolvedValueOnce({ id: "c1", name: "Acme", firmClient: { clientCode: "ACME" } }).mockResolvedValueOnce({ id: "c2", name: "B", firmClient: null }).mockResolvedValueOnce(null) },
    });
    const turia = { findClientByCode: vi.fn() };
    const ports = prismaValidationPorts(d as never, turia);
    expect(await ports.findFirmClientByCode("ACME")).toEqual({ lmsClientId: "c1", legalName: "Acme" });
    expect(await ports.findFirmClientByCode("NONE")).toBeNull();
    expect(await ports.findLmsClient({ name: "Acme", pan: "AAACA1234F" })).toEqual({ id: "c1", name: "Acme", clientCode: "ACME" });
    expect(d.client.findFirst.mock.calls[0][0].where.OR).toHaveLength(2);
    expect(await ports.findLmsClient({ pan: "AAACA1234F" })).toEqual({ id: "c2", name: "B", clientCode: null });
    expect(await ports.findLmsClient({ name: "Z" })).toBeNull();
    expect(await ports.findLmsClient({})).toBeNull();
    expect(await ports.findActiveUser("u1")).toEqual({ id: "u1", name: "a@x" });
    d.user.findFirst.mockResolvedValueOnce(null as never);
    expect(await ports.findActiveUser("gone")).toBeNull();
    expect(ports.turia).toBe(turia);
  });
});

describe("saga store", () => {
  const spec = completeSpec();

  it("claims, saves and sets the site", async () => {
    const d = db();
    const s = prismaSagaStore(d as never, () => NOW);
    expect(await s.claimRun("run-1", NOW)).toBe(true);
    d.onboardingRun.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    expect(await s.claimRun("run-1", NOW)).toBe(false);
    await s.saveRun("run-1", { status: "RUNNING", steps: [], error: null, firmClientId: "fc" });
    expect(d.onboardingRun.update.mock.calls[0][0].data).toEqual({ status: "RUNNING", steps: [], error: null, firmClientId: "fc" });
    await s.saveRun("run-1", {});
    expect((await s.getRun("run-1"))?.id).toBe("run-1");
    d.onboardingRun.findUnique.mockResolvedValueOnce(null as never);
    expect(await s.getRun("x")).toBeNull();
    await s.setClientSite("fc", "https://x");
    expect(d.firmClient.update).toHaveBeenCalledWith({ where: { id: "fc" }, data: { clSiteUrl: "https://x" } });
  });

  it("createOrLinkClient: creates Client (via the /clients service) + FirmClient in one transaction", async () => {
    const d = db();
    const r = await prismaSagaStore(d as never, () => NOW).createOrLinkClient({ spec, plan: plan(), actorId: "u-partner" });
    expect(r).toEqual({ lmsClientId: "c-new", firmClientId: "fc-1", linked: false });
    expect(d.$transaction).toHaveBeenCalledTimes(1);
    const data = d.client.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: spec.legalName, folderName: spec.legalName, entityType: "PVT_LTD", pan: spec.pan, gstin: spec.gstins[0], turnover: 25_000_000, turnoverBand: "CR1_TO_5CR", growthGoal: "MAINTAIN", primaryHandlerId: "u-priya", createdById: "u-partner", onboardedOn: NOW });
    expect(d.firmClient.create).toHaveBeenCalledWith({ data: { lmsClientId: "c-new", clientCode: "ACME01", createdById: "u-partner" } });
  });

  it("createOrLinkClient: adopts its own FirmClient on re-run, refuses someone else's code", async () => {
    const same = db({ firmClient: { findUnique: vi.fn(async () => ({ id: "fc-9", lmsClientId: "c-9", client: { name: spec.legalName.toUpperCase(), pan: null } })) } });
    expect(await prismaSagaStore(same as never).createOrLinkClient({ spec, plan: plan(), actorId: "u" })).toEqual({ lmsClientId: "c-9", firmClientId: "fc-9", linked: true });
    const byPan = db({ firmClient: { findUnique: vi.fn(async () => ({ id: "fc-9", lmsClientId: "c-9", client: { name: "Renamed", pan: spec.pan } })) } });
    expect((await prismaSagaStore(byPan as never).createOrLinkClient({ spec, plan: plan(), actorId: "u" })).linked).toBe(true);
    const other = db({ firmClient: { findUnique: vi.fn(async () => ({ id: "fc-9", lmsClientId: "c-9", client: { name: "Other", pan: "X" } })) } });
    await expect(prismaSagaStore(other as never).createOrLinkClient({ spec, plan: plan(), actorId: "u" })).rejects.toThrow(/already used by Other/);
  });

  it("createOrLinkClient: links the planned existing client, or a duplicate found at execution time", async () => {
    const link = db();
    expect(await prismaSagaStore(link as never).createOrLinkClient({ spec, plan: plan({ lmsClient: { action: "link", existingId: "c-1", existingName: "A" } }), actorId: "u" })).toMatchObject({ lmsClientId: "c-1", linked: true });
    expect(link.client.create).not.toHaveBeenCalled();
    const dup = db({ client: { findFirst: vi.fn(async () => ({ id: "c-dup", name: "A" })) } });
    expect(await prismaSagaStore(dup as never).createOrLinkClient({ spec, plan: plan(), actorId: "u" })).toMatchObject({ lmsClientId: "c-dup", linked: true });
    const taken = db({ firmClient: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ clientCode: "OLD" }) } });
    await expect(prismaSagaStore(taken as never).createOrLinkClient({ spec, plan: plan({ lmsClient: { action: "link", existingId: "c-1", existingName: "A" } }), actorId: "u" })).rejects.toThrow(/already linked to Firm OS as OLD/);
  });

  it("ensureEngagements upserts by (client, service) without overwriting", async () => {
    const d = db();
    const ids = await prismaSagaStore(d as never).ensureEngagements({ firmClientId: "fc", lines: spec.services, people: { assignee: { id: "a", name: "A" }, reviewer: { id: "r", name: "R" } }, firstPeriod: "2026-11" });
    expect(ids).toEqual({ GST: "eng-GST", ROC: "eng-ROC", Books: "eng-Books" });
    expect(d.engagement.upsert.mock.calls[0][0]).toMatchObject({ where: { firmClientId_service: { firmClientId: "fc", service: "GST" } }, update: {} });
  });

  it("ensureJobTasks: creates missing (ASSIGNED + event), skips existing, treats a unique race as existing", async () => {
    const d = db({
      jobTask: {
        findUnique: vi.fn().mockResolvedValueOnce({ id: "jt-old" }).mockResolvedValue(null),
        create: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(p2002()).mockRejectedValueOnce(new Error("db down")),
      },
    });
    const job = (period: string, dated = true) => ({ ruleId: "gstr-1", service: "GST" as const, title: "GSTR-1", fy: "2026-27", period, statutoryDueOn: dated ? "2026-12-11T00:00:00.000Z" : null, internalDueOn: dated ? "2026-12-08T00:00:00.000Z" : null, dueNote: null, turiaTaskNow: false });
    const people = { assignee: { id: "a", name: "A" }, reviewer: { id: "r", name: "R" } };
    const s = prismaSagaStore(d as never);
    expect(await s.ensureJobTasks({ firmClientId: "fc", engagementIds: { GST: "eng" }, jobs: [job("2026-10"), job("2026-11"), job("2026-12", false)], people, actorId: "u" })).toEqual({ created: 1, existing: 2 });
    const data = d.jobTask.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ state: "ASSIGNED", assigneeId: "a", reviewerId: "r", engagementId: "eng", events: { create: { fromState: null, toState: "ASSIGNED", actorId: "u" } } });
    expect(data.statutoryDueOn).toEqual(new Date("2026-12-11T00:00:00.000Z"));
    expect(d.jobTask.create.mock.calls[1][0].data.statutoryDueOn).toBeNull();
    await expect(s.ensureJobTasks({ firmClientId: "fc", engagementIds: {}, jobs: [job("2027-01")], people, actorId: "u" })).rejects.toThrow("db down");
  });

  it("lists tasks, checks users, writes audit events", async () => {
    const d = db();
    const s = prismaSagaStore(d as never);
    expect(await s.listJobTasks("fc")).toEqual([]);
    expect(await s.activeUser("u1")).toEqual({ id: "u1", name: "a@x" });
    d.user.findFirst.mockResolvedValueOnce(null as never);
    expect(await s.activeUser("x")).toBeNull();
    await s.audit({ actorId: "u", action: "a", entity: "E", entityId: null, meta: { k: 1 } });
    await s.audit({ actorId: "u", action: "b", entity: "E", entityId: null });
    expect(d.auditEvent.create.mock.calls.map((c) => c[0].data.meta)).toEqual([{ k: 1 }, undefined]);
    await setTuriaClientRef(d as never, "fc", "T-1");
    expect(d.firmClient.update).toHaveBeenCalledWith({ where: { id: "fc" }, data: { turiaClientRef: "T-1" } });
  });

  it("clientBodyFromSpec uses the /clients schema (proprietor without GSTIN/CIN)", () => {
    const body = clientBodyFromSpec(completeSpec({ entityType: "PROPRIETORSHIP", gstins: [], cin: undefined, growthGoal: "EXPORT" }), NOW);
    expect(body).toMatchObject({ gstin: null, cin: null, growthGoal: "EXPORT", onboardedOn: NOW });
  });
});

describe("loadCalendarPack", () => {
  it("defaults when no SopPack has a calendar", async () => {
    const r = await loadCalendarPack(db() as never);
    expect(r.pack.rules.map((x) => x.id)).toEqual(DEFAULT_CALENDAR.rules.map((x) => x.id));
    expect(r.source).toBe("Statutory calendar: defaults (no SopPack calendar yet)");
  });

  it("active SopPack rules override the defaults; the highest version per key wins; invalid packs are skipped", async () => {
    const custom = defaultCalendarJson() as { rules: Array<{ id: string; due: unknown }> } & Record<string, unknown>;
    const gstr1 = { ...custom.rules.find((x) => x.id === "gstr-1")!, due: { anchor: "period-end", addMonths: 1, day: 12 } };
    const packs = [
      { key: "gst", version: "1.2.0", calendar: { ...custom, rules: [gstr1] }, bufferDays: 2 },
      { key: "gst", version: "1.1.0", calendar: { ...custom, rules: [] }, bufferDays: 5 },
      { key: "roc", version: "1.0.0", calendar: { nonsense: true }, bufferDays: 3 },
    ];
    const r = await loadCalendarPack(db({ sopPack: { findMany: vi.fn(async () => packs) } }) as never);
    expect(r.pack.rules.find((x) => x.id === "gstr-1")!.due).toEqual({ anchor: "period-end", addMonths: 1, day: 12 });
    expect(r.pack.rules).toHaveLength(DEFAULT_CALENDAR.rules.length);
    expect(r.pack.bufferDays).toBe(2);
    expect(r.source).toBe("Statutory calendar: SopPack gst 1.2.0 over the defaults; skipped invalid roc 1.0.0");
  });

  it("falls back to the defaults when packs conflict", async () => {
    const custom = defaultCalendarJson() as Record<string, unknown>;
    const packs = [
      { key: "a", version: "1.0.0", calendar: { ...custom, rules: [], stateGroups: { x: ["29"] } }, bufferDays: 3 },
    ];
    const r = await loadCalendarPack(db({ sopPack: { findMany: vi.fn(async () => packs) } }) as never);
    expect(r.pack).toBe(DEFAULT_CALENDAR);
    expect(r.source).toMatch(/conflict/);
  });
});

describe("fixtures sanity", () => {
  it("synthetic people are unique", () => {
    expect(new Set(PEOPLE.map((p) => p.id)).size).toBe(PEOPLE.length);
  });
});

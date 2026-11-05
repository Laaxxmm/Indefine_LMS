import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TuriaSync } from "@prisma/client";
import { FakeTuriaRepo } from "../../../../tests/fakes/fake-turia-repo";
import { BlockedError } from "../sharepoint/errors";
import { TURIA_ADAPTER_METHODS, type TuriaClientInput, type TuriaServiceInput, type TuriaTaskInput } from "./adapter";
import { ApiBridge } from "./api-bridge";
import { listTuriaSyncs, prismaTuriaSyncRepo, toRecord } from "./db";
import { NO_TURIA_API_ACTION, TuriaBlockedError, TuriaConfirmError, UI_BRIDGE_DISABLED_ACTION, UI_BRIDGE_NOT_BUILT_ACTION, UI_BRIDGE_PARTNER_ONLY_ACTION } from "./errors";
import { createTuriaAdapter, manualBridge, turiaBridgeMode } from "./factory";
import { MAX_MINUTES, ManualBridge, addServiceChecklist, closeTaskChecklist, createClientChecklist, createTaskChecklist } from "./manual-bridge";
import { UiAutomationBridge, isTuriaUiEnabled } from "./ui-bridge";

const NOW = () => new Date("2026-11-05T12:00:00Z");

const CLIENT: TuriaClientInput = {
  firmClientId: "fc-1",
  clientCode: "ACME01",
  legalName: "Acme Widgets Private Limited",
  entityType: "PVT_LTD",
  pan: "AAACA1234F",
  gstins: ["29AAACA1234F1Z5", "33AAACA1234F1Z1"],
  cin: "U12345KA2020PTC123456",
  contactName: "Meera Rao",
  contactEmail: "meera@acme.test",
  contactPhone: "9876543210",
  billing: "Retainer ₹15,000 per month",
};

const SERVICE: TuriaServiceInput = {
  firmClientId: "fc-1",
  clientCode: "ACME01",
  legalName: CLIENT.legalName,
  service: "GST",
  frequency: "MONTHLY",
  assigneeName: "Priya Sharma",
  reviewerName: "Ravi Kumar",
  firstPeriod: "2026-11",
};

const TASK: TuriaTaskInput = {
  firmClientId: "fc-1",
  jobTaskId: "jt-1",
  clientCode: "ACME01",
  legalName: CLIENT.legalName,
  service: "GST",
  title: "GSTR-3B",
  fy: "2026-27",
  period: "2026-11",
  assigneeName: "Priya Sharma",
  reviewerName: "Ravi Kumar",
  dueOn: new Date("2026-12-20T00:00:00+05:30"),
};

describe("ManualBridge checklists", () => {
  it("createClient checklist is exact, numbered and prefilled (snapshot)", () => {
    expect(createClientChecklist(CLIENT)).toMatchSnapshot();
  });
  it("addService checklist (snapshot)", () => {
    expect(addServiceChecklist(SERVICE)).toMatchSnapshot();
  });
  it("createTask checklist shows the due date as DD MMM YYYY in IST (snapshot)", () => {
    const c = createTaskChecklist(TASK);
    expect(JSON.stringify(c)).toContain("20 Dec 2026");
    expect(c).toMatchSnapshot();
  });
  it("closeTask checklist requires minutes (snapshot)", () => {
    const c = closeTaskChecklist("T-991", 45, { clientCode: "ACME01", title: "GSTR-3B 2026-11" });
    expect(c.confirmWith.minutesRequired).toBe(true);
    expect(c).toMatchSnapshot();
  });
  it("omits steps for values that are not known", () => {
    const c = createClientChecklist({ firmClientId: "fc-2", clientCode: "BETA", legalName: "Beta", entityType: "INDIVIDUAL" });
    const text = c.steps.map((s) => s.text).join("\n");
    expect(text).not.toMatch(/PAN|GSTIN|CIN|contact|billing/i);
    expect(c.steps.map((s) => s.n)).toEqual(c.steps.map((_, i) => i + 1));
    const one = createClientChecklist({ ...CLIENT, gstins: ["29AAACA1234F1Z5"] });
    expect(JSON.stringify(one)).toContain('"label":"GSTIN"');
    const minimal = createTaskChecklist({ ...TASK, reviewerName: null, dueOn: null });
    expect(JSON.stringify(minimal)).not.toContain("Due date");
    const svc = addServiceChecklist({ ...SERVICE, firstPeriod: null, reviewerName: undefined });
    expect(JSON.stringify(svc)).not.toContain("First period");
    expect(closeTaskChecklist("T-1", 5).steps[1].values).toEqual([{ label: "Task ref", value: "T-1" }]);
  });
});

describe("ManualBridge", () => {
  it("issues a CHECKLIST_ISSUED TuriaSync row in MANUAL mode for each operation", async () => {
    const repo = new FakeTuriaRepo();
    const bridge = new ManualBridge(repo, NOW);
    const a = await bridge.createClient(CLIENT, "u-partner");
    const b = await bridge.addService(SERVICE);
    const c = await bridge.createTask(TASK);
    const d = await bridge.closeTask(" T-991 ", 30, { jobTaskId: "jt-1", firmClientId: "fc-1" });
    for (const r of [a, b, c, d]) {
      expect(r).toMatchObject({ mode: "MANUAL", status: "CHECKLIST_ISSUED", turiaRef: null, reused: false });
      expect(r.checklist?.steps.length).toBeGreaterThan(2);
    }
    expect(repo.rows.map((r) => [r.operation, r.mode, r.status, r.firmClientId, r.jobTaskId])).toEqual([
      ["createClient", "MANUAL", "CHECKLIST_ISSUED", "fc-1", null],
      ["addService", "MANUAL", "CHECKLIST_ISSUED", "fc-1", null],
      ["createTask", "MANUAL", "CHECKLIST_ISSUED", "fc-1", "jt-1"],
      ["closeTask", "MANUAL", "CHECKLIST_ISSUED", "fc-1", "jt-1"],
    ]);
    expect(repo.rows[0].evidence?.issuedById).toBe("u-partner");
    expect(bridge.mode).toBe("MANUAL");
  });

  it("is idempotent: re-issuing returns the same row, never a duplicate", async () => {
    const repo = new FakeTuriaRepo();
    const bridge = new ManualBridge(repo, NOW);
    const first = await bridge.addService(SERVICE);
    const again = await bridge.addService(SERVICE);
    expect(again).toMatchObject({ syncId: first.syncId, reused: true });
    expect(repo.rows).toHaveLength(1);
    await bridge.addService({ ...SERVICE, service: "ROC", frequency: "ANNUAL" });
    expect(repo.rows).toHaveLength(2);
  });

  it("re-issues after a FAILED row", async () => {
    const repo = new FakeTuriaRepo();
    const bridge = new ManualBridge(repo, NOW);
    const first = await bridge.createClient(CLIENT);
    repo.rows[0].status = "FAILED";
    const second = await bridge.createClient(CLIENT);
    expect(second.syncId).not.toBe(first.syncId);
    expect(second.reused).toBe(false);
  });

  it("closeTask validates the ref and the minutes before issuing", () => {
    const bridge = new ManualBridge(new FakeTuriaRepo(), NOW);
    expect(() => bridge.closeTask("  ", 10)).toThrow(TuriaConfirmError);
    expect(() => bridge.closeTask("T-1", 0)).toThrow(/whole number/);
    expect(() => bridge.closeTask("T-1", 1.5)).toThrow(/whole number/);
    expect(() => bridge.closeTask("T-1", MAX_MINUTES + 1)).toThrow(/whole number/);
  });

  it("findClientByCode is 'unknown' and becomes a checklist item", async () => {
    const r = await new ManualBridge(new FakeTuriaRepo()).findClientByCode("ACME01");
    expect(r).toMatchObject({ status: "unknown" });
    expect(r.status === "unknown" && r.checklistItem).toContain("ACME01");
  });

  describe("confirm", () => {
    it("moves createClient to CONFIRMED with ref, person and time", async () => {
      const repo = new FakeTuriaRepo();
      const bridge = new ManualBridge(repo, NOW);
      const { syncId } = await bridge.createClient(CLIENT);
      const rec = await bridge.confirm(syncId, { turiaRef: "  TUR-CL-77 ", confirmedBy: "u-staff" });
      expect(rec).toMatchObject({ status: "CONFIRMED", turiaRef: "TUR-CL-77", confirmedById: "u-staff", minutesLogged: null });
      expect(rec.evidence?.confirmedAt).toBe("2026-11-05T12:00:00.000Z");
      expect(rec.evidence?.key).toBe("createClient:fc-1");
    });

    it("moves closeTask to CLOSED and requires minutes", async () => {
      const repo = new FakeTuriaRepo();
      const bridge = new ManualBridge(repo, NOW);
      const { syncId } = await bridge.closeTask("T-9", 30, { jobTaskId: "jt-9" });
      await expect(bridge.confirm(syncId, { turiaRef: "T-9", confirmedBy: "u" })).rejects.toThrow(/minutes/);
      const rec = await bridge.confirm(syncId, { turiaRef: "T-9", minutes: 35, confirmedBy: "u" });
      expect(rec).toMatchObject({ status: "CLOSED", minutesLogged: 35 });
    });

    it("is idempotent for the same ref and refuses a different one", async () => {
      const bridge = new ManualBridge(new FakeTuriaRepo(), NOW);
      const { syncId } = await bridge.createTask(TASK);
      await bridge.confirm(syncId, { turiaRef: "TK-1", confirmedBy: "u", minutes: 10 });
      const same = await bridge.confirm(syncId, { turiaRef: "TK-1", confirmedBy: "u2" });
      expect(same.confirmedById).toBe("u");
      await expect(bridge.confirm(syncId, { turiaRef: "TK-2", confirmedBy: "u" })).rejects.toMatchObject({ code: "conflict" });
    });

    it("rejects unknown syncs, blank and over-long refs", async () => {
      const bridge = new ManualBridge(new FakeTuriaRepo(), NOW);
      await expect(bridge.confirm("nope", { turiaRef: "x", confirmedBy: "u" })).rejects.toMatchObject({ code: "not-found" });
      const { syncId } = await bridge.createClient(CLIENT);
      await expect(bridge.confirm(syncId, { turiaRef: "   ", confirmedBy: "u" })).rejects.toMatchObject({ code: "invalid" });
      await expect(bridge.confirm(syncId, { turiaRef: "x".repeat(101), confirmedBy: "u" })).rejects.toMatchObject({ code: "invalid" });
    });

    it("keeps a key when the row had no evidence", async () => {
      const repo = new FakeTuriaRepo();
      const bridge = new ManualBridge(repo);
      const { syncId } = await bridge.createClient(CLIENT);
      repo.rows[0].evidence = null;
      const rec = await bridge.confirm(syncId, { turiaRef: "R", confirmedBy: "u" });
      expect(rec.evidence?.key).toBe(syncId);
    });
  });
});

describe("UiAutomationBridge (stub)", () => {
  const call = (b: UiAutomationBridge) => [
    () => b.createClient(CLIENT),
    () => b.addService(SERVICE),
    () => b.createTask(TASK),
    () => b.closeTask("T", 1),
    () => b.findClientByCode("ACME01"),
  ];

  it("is disabled by default and every method is BLOCKED with the human action", async () => {
    const b = new UiAutomationBridge({ env: {} });
    expect(b.enabled).toBe(false);
    expect(b.dryRun).toBe(true);
    for (const fn of call(b)) {
      const e = await fn().catch((x) => x);
      expect(e).toBeInstanceOf(TuriaBlockedError);
      expect(e).toBeInstanceOf(BlockedError);
      expect(e.action).toBe(UI_BRIDGE_DISABLED_ACTION);
    }
  });

  it("enabled: partner-only, and still not built", async () => {
    const env = { FIRM_OS_TURIA_UI: "true" };
    await expect(new UiAutomationBridge({ env }).createClient(CLIENT)).rejects.toMatchObject({ action: UI_BRIDGE_PARTNER_ONLY_ACTION });
    const b = new UiAutomationBridge({ env, actorIsPartner: true, dryRun: false });
    expect(b.dryRun).toBe(false);
    for (const fn of call(b)) await expect(fn()).rejects.toMatchObject({ action: UI_BRIDGE_NOT_BUILT_ACTION });
  });

  it("reads FIRM_OS_TURIA_UI strictly", () => {
    expect(isTuriaUiEnabled({ FIRM_OS_TURIA_UI: " TRUE " })).toBe(true);
    expect(isTuriaUiEnabled({ FIRM_OS_TURIA_UI: "1" })).toBe(false);
    expect(isTuriaUiEnabled({})).toBe(false);
  });
});

describe("ApiBridge", () => {
  it("is not available: every method is BLOCKED (no documented Turia API)", async () => {
    const b = new ApiBridge();
    expect(b.mode).toBe("API");
    for (const fn of [() => b.createClient(CLIENT), () => b.addService(SERVICE), () => b.createTask(TASK), () => b.closeTask("T", 1), () => b.findClientByCode("X")]) {
      await expect(fn()).rejects.toMatchObject({ name: "TuriaBlockedError", action: NO_TURIA_API_ACTION });
    }
  });
});

describe("factory", () => {
  it("defaults to MANUAL and honours FIRM_OS_TURIA_BRIDGE", () => {
    expect(turiaBridgeMode({})).toBe("MANUAL");
    expect(turiaBridgeMode({ FIRM_OS_TURIA_BRIDGE: " ui " })).toBe("UI");
    expect(turiaBridgeMode({ FIRM_OS_TURIA_BRIDGE: "API" })).toBe("API");
    expect(() => turiaBridgeMode({ FIRM_OS_TURIA_BRIDGE: "SCRAPE" })).toThrow(/must be one of/);
    const repo = new FakeTuriaRepo();
    expect(createTuriaAdapter({ env: {}, repo })).toBeInstanceOf(ManualBridge);
    expect(createTuriaAdapter({ env: { FIRM_OS_TURIA_BRIDGE: "UI" }, repo })).toBeInstanceOf(UiAutomationBridge);
    expect(createTuriaAdapter({ env: { FIRM_OS_TURIA_BRIDGE: "API" }, repo })).toBeInstanceOf(ApiBridge);
    expect(manualBridge(repo)).toBeInstanceOf(ManualBridge);
  });
});

describe("no destructive operation (NON-NEGOTIABLE #2)", () => {
  const DESTRUCTIVE = /^(delete|remove|purge|destroy|drop|archive|erase|wipe)/i;
  it("no bridge exposes a delete/archive method", () => {
    for (const cls of [ManualBridge, UiAutomationBridge, ApiBridge]) {
      const names = Object.getOwnPropertyNames(cls.prototype).filter((n) => n !== "constructor");
      expect(names.filter((n) => DESTRUCTIVE.test(n))).toEqual([]);
      for (const m of TURIA_ADAPTER_METHODS) expect(names).toContain(m);
    }
  });

  it("the adapter interface declares only the five operations", () => {
    const src = readFileSync(new URL("./adapter.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("export interface TuriaAdapter"), src.indexOf("}", src.indexOf("export interface TuriaAdapter")));
    const methods = [...block.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual([...TURIA_ADAPTER_METHODS]);
  });
});

describe("prismaTuriaSyncRepo", () => {
  const row = (o: Partial<TuriaSync> = {}): TuriaSync => ({
    id: "s1", jobTaskId: null, firmClientId: "fc-1", operation: "createClient", mode: "MANUAL", status: "CHECKLIST_ISSUED",
    turiaRef: null, minutesLogged: null, evidence: { key: "createClient:fc-1" }, confirmedById: null, spotChecked: false,
    createdAt: new Date(0), updatedAt: new Date(0), ...o,
  });

  it("maps rows and filters by evidence key", async () => {
    const turiaSync = {
      findFirst: vi.fn().mockResolvedValueOnce(row()).mockResolvedValueOnce(null),
      create: vi.fn().mockResolvedValue(row()),
      findUnique: vi.fn().mockResolvedValueOnce(row({ evidence: null })).mockResolvedValueOnce(null),
      update: vi.fn().mockResolvedValue(row({ status: "CONFIRMED", turiaRef: "R" })),
      findMany: vi.fn().mockResolvedValue([row(), row({ id: "s2" })]),
    };
    const db = { turiaSync } as never;
    const repo = prismaTuriaSyncRepo(db);
    expect((await repo.findByKey("createClient:fc-1"))?.id).toBe("s1");
    expect(turiaSync.findFirst).toHaveBeenCalledWith({ where: { evidence: { path: ["key"], equals: "createClient:fc-1" } }, orderBy: { createdAt: "desc" } });
    expect(await repo.findByKey("nope")).toBeNull();
    await repo.create({ jobTaskId: null, firmClientId: "fc-1", operation: "createClient", mode: "MANUAL", status: "CHECKLIST_ISSUED", evidence: { key: "k" } });
    expect(turiaSync.create.mock.calls[0][0].data.evidence).toEqual({ key: "k" });
    expect((await repo.get("s1"))?.evidence).toBeNull();
    expect(await repo.get("nope")).toBeNull();
    expect((await repo.update("s1", { status: "CONFIRMED", turiaRef: "R", minutesLogged: null, confirmedById: "u", evidence: { key: "k" } })).status).toBe("CONFIRMED");
    expect((await listTuriaSyncs(db, "fc-1")).map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(toRecord(row()).operation).toBe("createClient");
  });
});

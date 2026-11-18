import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import { completeSpec } from "./__fixtures__/synthetic";
import { buildPlan, isConfirmRequired, markFirstOfSeries, summarizeJobs } from "./plan";
import {
  NO_CALENDAR_RULE, calendarResolver, createCalendarPlanner, createCatalogPlanner, itrCategory, monthsFrom, periodsFor, quarterOf, quartersFrom, templatesFor,
  type DueDateResolver, type JobPlanInput,
} from "./planner";

const NOW = new Date("2026-11-05T10:00:00Z");
const fakeDue: DueDateResolver = (job) => ({ kind: "due", statutoryDue: new Date(`2026-12-20T00:00:00+05:30`), internalDue: new Date(`2026-12-17T00:00:00+05:30`), note: job.title === "GSTR-1" ? "n" : null });
const input = (o: Partial<JobPlanInput> = {}): JobPlanInput => ({
  entityType: "PVT_LTD",
  services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC", frequency: "ANNUAL" }],
  fy: "2026-27",
  firstPeriod: "2026-11",
  qrmp: false,
  gstStateCode: "29",
  ...o,
});

describe("periods", () => {
  it("months and quarters from the first period to the FY end", () => {
    expect(monthsFrom("2026-27", "2026-11")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(monthsFrom("2026-27")).toHaveLength(12);
    expect(quartersFrom("2026-11")).toEqual(["Q3", "Q4"]);
    expect(quartersFrom("2027-02")).toEqual(["Q4"]);
    expect(quartersFrom(null)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(quarterOf("2026-04")).toBe("Q1");
    expect(quarterOf("2026-09")).toBe("Q2");
    expect(periodsFor("ANNUAL", "2026-27", "2026-11")).toEqual(["Annual"]);
  });

  it("templates follow frequency and entity type", () => {
    expect(templatesFor({ service: "GST", frequency: "QUARTERLY" }, "PVT_LTD").map((t) => t.title)).toEqual(["GSTR-1 (QRMP)", "GSTR-3B (QRMP)", "GSTR-9"]);
    expect(templatesFor({ service: "ROC", frequency: "ANNUAL" }, "PVT_LTD").map((t) => t.title)).toEqual(["AOC-4", "MGT-7", "ADT-1", "DIR-3 KYC"]);
    expect(templatesFor({ service: "ROC", frequency: "ANNUAL" }, "LLP").map((t) => t.title)).toEqual(["LLP Form 11", "LLP Form 8"]);
    expect(templatesFor({ service: "ROC", frequency: "ANNUAL" }, "PARTNERSHIP").map((t) => t.title)).toEqual(["ROC annual filing"]);
    expect(templatesFor({ service: "Books", frequency: "QUARTERLY" }, "HUF").map((t) => t.cadence)).toEqual(["QUARTERLY"]);
  });

  it("ITR category: audit for companies or when Audit is a service", () => {
    expect(itrCategory(input())).toBe("audit");
    expect(itrCategory(input({ entityType: "INDIVIDUAL", services: [] }))).toBe("non-audit");
    expect(itrCategory(input({ entityType: "PARTNERSHIP", services: [{ service: "Audit", frequency: "ANNUAL" }] }))).toBe("audit");
  });
});

describe("createCatalogPlanner (injected fake resolver)", () => {
  it("one job per template × period, dates from the resolver", async () => {
    const jobs = await createCatalogPlanner({ dueDates: fakeDue, source: "fake" }).planJobs(input());
    expect(jobs.map((j) => `${j.title}@${j.period}`)).toEqual([
      "GSTR-1@2026-11", "GSTR-1@2026-12", "GSTR-1@2027-01", "GSTR-1@2027-02", "GSTR-1@2027-03",
      "GSTR-3B@2026-11", "GSTR-3B@2026-12", "GSTR-3B@2027-01", "GSTR-3B@2027-02", "GSTR-3B@2027-03",
      "GSTR-9@Annual", "AOC-4@Annual", "MGT-7@Annual", "ADT-1@Annual", "DIR-3 KYC@Annual",
    ]);
    expect(jobs[0]).toMatchObject({ ruleId: "gstr-1", service: "GST", fy: "2026-27", dueNote: "n" });
    expect(jobs[5].dueNote).toBeNull();
  });

  it("passes the calendar context and honours pending / not-applicable", async () => {
    const seen: unknown[] = [];
    const planner = createCatalogPlanner({
      source: "fake",
      dueDates: (job, ctx) => {
        seen.push(ctx);
        if (job.title === "GSTR-9") return { kind: "not-applicable", reason: "exempt" };
        return { kind: "pending", reason: "no AGM" };
      },
    });
    const jobs = await planner.planJobs(input({ services: [{ service: "GST", frequency: "QUARTERLY" }, { service: "IncomeTax", frequency: "ANNUAL" }], qrmp: true, agmDate: new Date("2026-09-30") }));
    expect(jobs.map((j) => j.title)).not.toContain("GSTR-9");
    expect(jobs.every((j) => j.statutoryDueOn === null && j.dueNote === "no AGM")).toBe(true);
    expect(seen[0]).toMatchObject({ fy: "2026-27", period: "Q3", qrmp: true, state: "29", agmDate: new Date("2026-09-30") });
    expect(seen.find((c) => (c as { category?: string }).category === "audit")).toBeTruthy();
    expect(seen.find((c) => (c as { category?: string }).category === "regular")).toBeTruthy();
  });
});

describe("calendar wiring (real dueDatesFor over DEFAULT_CALENDAR)", () => {
  it("GSTR-1 11th, GSTR-3B 20th, internal = statutory − 3 days moved back off weekends", async () => {
    const planner = createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "defaults" }) });
    const jobs = await planner.planJobs(input());
    expect(planner.source).toBe("defaults");
    const day = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null);
    const g1 = jobs.find((j) => j.title === "GSTR-1" && j.period === "2026-11")!;
    expect(day(g1.statutoryDueOn)).toBe("2026-12-11");
    expect(day(g1.internalDueOn)).toBe("2026-12-08");
    const g3 = jobs.find((j) => j.title === "GSTR-3B" && j.period === "2026-11")!;
    expect(day(g3.statutoryDueOn)).toBe("2026-12-20"); // Sunday: statutory date never moves
    expect(g3.dueNote).toMatch(/non-working day/);
    expect(day(g3.internalDueOn)).toBe("2026-12-17");
    expect(day(jobs.find((j) => j.title === "GSTR-9")!.statutoryDueOn)).toBe("2027-12-31");
    const aoc4 = jobs.find((j) => j.title === "AOC-4")!;
    expect(aoc4.statutoryDueOn).toBeNull();
    expect(aoc4.dueNote).toMatch(/AGM/);
  });

  it("QRMP GSTR-3B uses the state group; Karnataka is the 22nd", async () => {
    const jobs = await createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "d" }) }).planJobs(
      input({ services: [{ service: "GST", frequency: "QUARTERLY" }], qrmp: true }),
    );
    const g3 = jobs.find((j) => j.title === "GSTR-3B (QRMP)" && j.period === "Q3")!;
    expect(new Date(g3.statutoryDueOn!.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)).toBe("2027-01-22");
    const g1 = jobs.find((j) => j.title === "GSTR-1 (QRMP)" && j.period === "Q3")!;
    expect(new Date(g1.statutoryDueOn!.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)).toBe("2027-01-13");
  });

  it("jobs with no calendar rule keep null dates with a note; NOT_APPLICABLE drops", async () => {
    const resolve = calendarResolver(DEFAULT_CALENDAR);
    expect(await resolve({ ruleId: "books-close", service: "Books", title: "Books close", fy: "2026-27", period: "2026-11" }, { fy: "2026-27", period: "2026-11" })).toEqual({ kind: "pending", reason: NO_CALENDAR_RULE });
    expect((await resolve({ ruleId: "gstr-1", service: "GST", title: "GSTR-1", fy: "2026-27", period: "Q3" }, { fy: "2026-27", period: "Q3", qrmp: false })).kind).toBe("not-applicable");
  });
});

describe("buildPlan", () => {
  const plannedJobs = async () => createCatalogPlanner({ dueDates: fakeDue, source: "fake" }).planJobs(input());
  const ctx = async (o = {}) => ({
    jobs: await plannedJobs(),
    existingLmsClient: null,
    turiaMode: "MANUAL" as const,
    checks: ["Search Turia for ACME01"],
    confirmRequired: true,
    plannerSource: "fake",
    people: { assignee: { id: "u-priya", name: "Priya Sharma" }, reviewer: { id: "u-ravi", name: "Ravi Kumar" } },
    now: NOW,
    ...o,
  });

  it("lists exactly what will be created", async () => {
    const plan = buildPlan(completeSpec(), await ctx());
    expect(plan).toMatchObject({
      version: 1,
      createdAt: NOW.toISOString(),
      clientCode: "ACME01",
      legalName: "Acme Widgets Private Limited",
      lmsClient: { action: "create" },
      turia: { mode: "MANUAL", tasksNow: 7 },
      sharepoint: { siteUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01", fy: "2026-27", services: ["GST", "ROC", "Books", "Engagement"] },
      confirmRequired: true,
      datesPending: 0,
      checks: ["Search Turia for ACME01"],
    });
    expect(plan.turia.operations).toEqual([
      { operation: "createClient" },
      { operation: "addService", service: "GST", frequency: "MONTHLY" },
      { operation: "addService", service: "ROC", frequency: "ANNUAL" },
      { operation: "addService", service: "Books", frequency: "MONTHLY" },
    ]);
    expect(plan.jobs.filter((j) => j.turiaTaskNow).map((j) => `${j.title}@${j.period}`)).toEqual(["GSTR-1@2026-11", "GSTR-3B@2026-11", "GSTR-9@Annual", "AOC-4@Annual", "MGT-7@Annual", "ADT-1@Annual", "DIR-3 KYC@Annual"]);
    expect(plan.jobs[0].statutoryDueOn).toBe(new Date("2026-12-20T00:00:00+05:30").toISOString());
  });

  it("links an existing LMS client and counts pending dates", async () => {
    const jobs = (await plannedJobs()).map((j, i) => (i < 2 ? { ...j, statutoryDueOn: null, internalDueOn: null } : j));
    const plan = buildPlan(completeSpec(), await ctx({ jobs, existingLmsClient: { id: "c-1", name: "Acme", clientCode: null } }));
    expect(plan.lmsClient).toEqual({ action: "link", existingId: "c-1", existingName: "Acme" });
    expect(plan.datesPending).toBe(2);
    expect(plan.jobs[0].internalDueOn).toBeNull();
  });

  it("summarizeJobs groups by series", async () => {
    const plan = buildPlan(completeSpec(), await ctx());
    const s = summarizeJobs(plan.jobs);
    expect(s[0]).toMatchObject({ service: "GST", title: "GSTR-1", count: 5, periods: ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"], note: "n" });
    expect(s).toHaveLength(7);
    expect(summarizeJobs(markFirstOfSeries([{ ruleId: "x", service: "ROC", title: "AOC-4", fy: "2026-27", period: "Annual", statutoryDueOn: null, internalDueOn: null, dueNote: null }]))[0].firstDue).toBeNull();
  });

  it("FIRM_OS_ONBOARD_CONFIRM defaults to true", () => {
    expect(isConfirmRequired({})).toBe(true);
    expect(isConfirmRequired({ FIRM_OS_ONBOARD_CONFIRM: "true" })).toBe(true);
    expect(isConfirmRequired({ FIRM_OS_ONBOARD_CONFIRM: " FALSE " })).toBe(false);
    expect(isConfirmRequired({ FIRM_OS_ONBOARD_CONFIRM: "0" })).toBe(false);
    expect(isConfirmRequired({ FIRM_OS_ONBOARD_CONFIRM: "maybe" })).toBe(true);
  });
});

// The pure pieces of the Turia pull: normalising a task/list row, reading the period, the rules,
// people / client matching and client codes, the settings, and the per-task plan.
import { describe, expect, it } from "vitest";
import { inPullWindow, pullSortColumn, turiaPullMode } from "./config";
import { clientCodeFor, matchClient, matchPerson } from "./match";
import { runResultMessage } from "./messages";
import { isCancelled, isCompleted, mirrorHash, normName, normaliseTask, sortedByUpdateDesc, toDate } from "./normalise";
import { fyFromName, fyOfMonth, monthFromName, monthPeriodOf, parsePeriod, quarterFromName } from "./period";
import { agentlessTitle, jobChanges, jobShape, planTask, type PlanContext } from "./plan";
import { guessService, matchesPattern, matchRule, parsePattern, SEED_RULES, type RuleRow } from "./rules";

const RULES: RuleRow[] = SEED_RULES.map((r) => ({ ...r, active: true }));
const IST = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6, 30));

describe("normaliseTask", () => {
  it("keeps the DPDP minimum and reads Turia's field spellings", () => {
    const f = normaliseTask({
      id: 77,
      uniqueidentity: "#TSK00077",
      taskname: "  GSTR-3B   Oct 2026 ",
      clientname: "M/s. Acme & Sons Pvt. Ltd.",
      clientcode: "acme",
      departmentname: "GST",
      taskstatus: 1,
      taskstatusname: "In progress",
      targetduedate: "18-11-2026",
      completedon: null,
      createdon: 1790000000,
      assignee: [{ id: "a", name: "A" }, { id: "a", name: "dup" }, "junk"],
      reviewer: [{ id: 9, name: "R" }],
      description: "secret",
    })!;
    expect(f).toEqual({
      id: "77",
      identity: "TSK00077",
      taskName: "GSTR-3B Oct 2026",
      clientName: "M/s. Acme & Sons Pvt. Ltd.",
      clientKey: "acme and sons private limited",
      clientCode: "ACME",
      department: "GST",
      status: "1",
      statusName: "In progress",
      dueOn: new Date(Date.UTC(2026, 10, 18)),
      completedOn: null,
      turiaCreatedOn: new Date(1790000000 * 1000),
      assignees: [{ id: "a", name: "A" }],
      reviewers: [{ id: "9", name: "R" }],
    });
    expect(Object.keys(f)).not.toContain("description");
  });

  it("refuses rows without an id, and falls back on missing names", () => {
    expect(normaliseTask(null)).toBeNull();
    expect(normaliseTask({ taskname: "x" })).toBeNull();
    expect(normaliseTask({ id: "5", department: { nested: true } })).toMatchObject({ taskName: "Turia task", clientName: "", department: null, identity: null });
    expect(normaliseTask({ id: "6", uniqueidentity: "TSK6" })!.taskName).toBe("Turia task TSK6");
  });

  it("reads dates in every shape Turia uses", () => {
    expect(toDate(1790000000000)!.getTime()).toBe(1790000000000);
    expect(toDate("1790000000")!.getTime()).toBe(1790000000000);
    expect(toDate("2026-11-18T00:00:00Z")!.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    for (const bad of [null, "", 12, "soon", {}, Number.NaN]) expect(toDate(bad)).toBeNull();
  });

  it("completed, cancelled, hash and sort checks", () => {
    expect(isCompleted({ status: "3", completedOn: null })).toBe(true);
    expect(isCompleted({ status: "1", completedOn: new Date() })).toBe(true);
    expect(isCompleted({ status: "1", completedOn: null })).toBe(false);
    expect(isCancelled({ statusName: "Cancelled by client" })).toBe(true);
    expect(isCancelled({ statusName: null })).toBe(false);
    const a = normaliseTask({ id: "1", taskname: "x", assignee: [{ id: "b", name: "B" }, { id: "a", name: "A" }] })!;
    const b = normaliseTask({ id: "1", taskname: "x", assignee: [{ id: "a", name: "A" }, { id: "b", name: "B" }] })!;
    expect(mirrorHash(a)).toBe(mirrorHash(b));
    expect(mirrorHash({ ...a, taskName: "y" })).not.toBe(mirrorHash(a));
    expect(sortedByUpdateDesc([{ updatedon: 3e12 }, { updatedon: 2e12 }])).toBe(true);
    expect(sortedByUpdateDesc([{ updatedon: 2e12 }, { updatedon: 3e12 }])).toBe(false);
    expect(sortedByUpdateDesc([{ createdon: 2e12 }])).toBe(false);
    expect(sortedByUpdateDesc([])).toBe(false);
    expect(normName("Acme Co.")).toBe("acme company");
  });
});

describe("period", () => {
  it("reads the month, quarter and FY from the name", () => {
    expect(fyOfMonth(2026, 4)).toBe("2026-27");
    expect(fyOfMonth(2027, 3)).toBe("2026-27");
    expect(monthFromName("GSTR-3B Oct 2026")).toEqual({ y: 2026, m: 10 });
    expect(monthFromName("GSTR-1 October-26")).toEqual({ y: 2026, m: 10 });
    expect(monthFromName("Books 10/2026")).toEqual({ y: 2026, m: 10 });
    expect(monthFromName("Books 2026-10")).toEqual({ y: 2026, m: 10 });
    expect(monthFromName("GSTR-3B Jan FY 2026-27")).toEqual({ y: 2027, m: 1 });
    expect(monthFromName("GSTR-3B June")).toBeNull();
    expect(monthFromName("no month")).toBeNull();
    expect(quarterFromName("TDS 26Q Q2")).toBe(2);
    expect(quarterFromName("TDS quarter 3")).toBe(3);
    expect(quarterFromName("TDS Jan-Mar")).toBe(4);
    expect(quarterFromName("TDS")).toBeNull();
    expect(fyFromName("ITR FY 2025-26")).toBe("2025-26");
    expect(fyFromName("ITR AY 2026-27")).toBe("2025-26");
    expect(fyFromName("Audit 2025-2026")).toBe("2025-26");
    expect(fyFromName("dated 10-11-2026")).toBeNull();
    expect(fyFromName("2025-27")).toBeNull();
  });

  it("falls back on the due date for each frequency", () => {
    expect(parsePeriod("GSTR-3B", "MONTHLY", IST(2026, 11, 20))).toEqual({ fy: "2026-27", period: "2026-10", from: "due date" });
    expect(parsePeriod("GSTR-3B", "MONTHLY", IST(2027, 1, 20))).toEqual({ fy: "2026-27", period: "2026-12", from: "due date" });
    expect(parsePeriod("TDS", "QUARTERLY", IST(2026, 10, 31))).toEqual({ fy: "2026-27", period: "Q2", from: "due date" });
    expect(parsePeriod("TDS", "QUARTERLY", IST(2027, 5, 31))).toEqual({ fy: "2026-27", period: "Q4", from: "due date" });
    expect(parsePeriod("TDS", "QUARTERLY", IST(2027, 2, 10))).toEqual({ fy: "2026-27", period: "Q3", from: "due date" });
    expect(parsePeriod("TDS Q4", "QUARTERLY", IST(2027, 5, 31))).toEqual({ fy: "2026-27", period: "Q4", from: "name" });
    expect(parsePeriod("TDS Q2 FY 2026-27", "QUARTERLY", null)).toEqual({ fy: "2026-27", period: "Q2", from: "name" });
    expect(parsePeriod("GSTR-1 QRMP Nov 2026", "QUARTERLY", null)).toEqual({ fy: "2026-27", period: "Q3", from: "name" });
    expect(parsePeriod("ITR", "ANNUAL", IST(2026, 7, 31))).toEqual({ fy: "2025-26", period: "Annual", from: "due date" });
    expect(parsePeriod("GSTR-9", "ANNUAL", IST(2027, 2, 28))).toEqual({ fy: "2025-26", period: "Annual", from: "due date" });
    expect(parsePeriod("ITR AY 2026-27", "ANNUAL", null)).toEqual({ fy: "2025-26", period: "Annual", from: "name" });
    for (const f of ["MONTHLY", "QUARTERLY", "ANNUAL"] as const) expect(parsePeriod("nothing", f, null)).toBeNull();
    expect(monthPeriodOf(new Date("2026-03-31T20:00:00Z"))).toEqual({ fy: "2026-27", period: "2026-04", from: "date" });
  });
});

describe("rules", () => {
  it("whole-word, any-of / all-of patterns", () => {
    expect(parsePattern(" gstr 3b | | a + b ")).toEqual([["gstr 3b"], ["a", "b"]]);
    expect(matchesPattern("GSTR-3B Oct 2026", "gstr 3b")).toBe(true);
    expect(matchesPattern("Arbitration fee", "itr")).toBe(false);
    expect(matchesPattern("GSTR-3B QRMP Q2", "gstr 3b+qrmp")).toBe(true);
    expect(matchesPattern("GSTR-3B Q2", "gstr 3b+qrmp")).toBe(false);
  });

  it("the seeds map the common Turia task names; first match by position wins", () => {
    const t = (taskName: string, department: string | null = null) => matchRule({ taskName, department }, RULES)?.title ?? null;
    expect(t("GSTR-3B QRMP Q2")).toBe("GSTR-3B (QRMP)");
    expect(t("GSTR3B October 2026")).toBe("GSTR-3B");
    expect(t("GSTR-1 Oct 2026")).toBe("GSTR-1");
    expect(t("GSTR-9C 2025-26")).toBe("GSTR-9");
    expect(t("TDS 24Q Q2")).toBe("TDS 24Q");
    expect(t("TDS return Q2")).toBe("TDS 26Q");
    expect(t("ITR-4 AY 2026-27")).toBe("ITR");
    expect(t("AOC-4 FY 2025-26")).toBe("AOC-4");
    expect(t("Annual filing", "Secretarial")).toBe("ROC annual filing");
    expect(t("Annual filing", "GST")).toBeNull();
    expect(t("Monthly bookkeeping")).toBe("Books close");
    expect(t("Statutory audit FY 2025-26")).toBe("Audit");
    expect(t("Visit client")).toBeNull();
    expect(matchRule({ taskName: "GSTR-1 Oct", department: null }, RULES.map((r) => ({ ...r, active: r.title !== "GSTR-1" })))).toBeNull();
  });

  it("guesses a label service for unmapped tasks", () => {
    expect(guessService({ taskName: "x", department: "GST" })).toBe("GST");
    expect(guessService({ taskName: "TDS challan", department: null })).toBe("TDS");
    expect(guessService({ taskName: "MCA notice", department: null })).toBe("ROC");
    expect(guessService({ taskName: "Tax notice reply", department: null })).toBe("IncomeTax");
    expect(guessService({ taskName: "Internal audit", department: null })).toBe("Audit");
    expect(guessService({ taskName: "x", department: "Accounts" })).toBe("Books");
    expect(guessService({ taskName: "Visit", department: "Admin" })).toBe("Engagement");
  });
});

describe("matching", () => {
  const users = [
    { id: "u1", name: "Priya S", email: "priya@x.test" },
    { id: "u2", name: "Ravi K", email: "ravi@x.test" },
    { id: "u3", name: "Ravi K", email: "ravi2@x.test" },
  ];
  it("people by email, then a unique exact name", () => {
    expect(matchPerson({ name: "Anyone", email: " PRIYA@x.test " }, users)).toEqual({ userId: "u1", matchedBy: "email" });
    expect(matchPerson({ name: "priya  s.", email: null }, users)).toEqual({ userId: "u1", matchedBy: "name" });
    expect(matchPerson({ name: "Ravi K", email: null }, users)).toBeNull(); // two people share the name
    expect(matchPerson({ name: "", email: null }, users)).toBeNull();
  });

  it("clients by code, then a unique exact normalised name", () => {
    const clients = [
      { id: "c1", name: "Acme Traders Private Limited", firmClient: { id: "f1", clientCode: "ACME" } },
      { id: "c2", name: "Beta LLP", firmClient: null },
      { id: "c3", name: "Twin", firmClient: null },
      { id: "c4", name: "twin", firmClient: null },
    ];
    expect(matchClient({ name: "Whatever", code: "acme" }, clients)?.id).toBe("c1");
    expect(matchClient({ name: "Acme Traders Pvt. Ltd.", code: null }, clients)?.id).toBe("c1");
    expect(matchClient({ name: "Twin", code: null }, clients)).toBeNull();
    expect(matchClient({ name: "", code: null }, clients)).toBeNull();
  });

  it("client codes: Turia's when valid and free, else made from the name and numbered", () => {
    expect(clientCodeFor("Acme", "ACME01", new Set())).toBe("ACME01");
    expect(clientCodeFor("Acme Traders Pvt Ltd", "acme-01", new Set())).toBe("ACMET");
    expect(clientCodeFor("Acme Traders Pvt Ltd", null, new Set(["ACMET"]))).toBe("ACMET01");
    expect(clientCodeFor("Con", null, new Set())).toBe("CON01"); // a Windows reserved name is never a code
    expect(clientCodeFor("X", null, new Set())).toBe("XCL");
    expect(clientCodeFor("The Pvt Ltd", null, new Set())).toBe("CLT");
  });
});

describe("settings and messages", () => {
  it("mode, sort and the IST window", () => {
    expect(turiaPullMode({})).toEqual({ mode: "off", valid: true });
    expect(turiaPullMode({ FIRM_OS_TURIA_PULL: "Dry-Run" })).toEqual({ mode: "dry-run", valid: true });
    expect(turiaPullMode({ FIRM_OS_TURIA_PULL: "on" })).toEqual({ mode: "on", valid: true });
    expect(turiaPullMode({ FIRM_OS_TURIA_PULL: "yes please" })).toEqual({ mode: "off", valid: false });
    expect(pullSortColumn({})).toBe("createdon");
    expect(pullSortColumn({ FIRM_OS_TURIA_PULL_SORT: "UpdatedOn" })).toBe("updatedon");
    expect(inPullWindow(new Date("2026-11-06T03:30:00Z"))).toBe(true); // Fri 09:00 IST
    expect(inPullWindow(new Date("2026-11-06T14:30:00Z"))).toBe(true); // 20:00 IST
    expect(inPullWindow(new Date("2026-11-06T14:45:00Z"))).toBe(false);
    expect(inPullWindow(new Date("2026-11-06T03:15:00Z"))).toBe(false);
    expect(inPullWindow(new Date("2026-11-08T06:00:00Z"))).toBe(false); // Sunday
  });

  it("the run sentence", () => {
    expect(runResultMessage({ mode: "dry-run", complete: true, fetched: 3, changed: 1 })).toBe("Read the whole task list from Turia (3 tasks, 1 new or changed). Dry run: nothing in Firm OS was changed. Check the preview below.");
    expect(runResultMessage({ mode: "on", complete: false, fetched: 0, changed: 0 })).toMatch(/^Read part of the task list.*Jobs were updated from Turia\.$/);
  });
});

describe("plan", () => {
  const m = { ...normaliseTask({ id: "1", uniqueidentity: "TSK1", taskname: "GSTR-3B Oct 2026", clientname: "Acme", assignee: [{ id: "ta", name: "A" }], reviewer: [{ id: "tr", name: "R" }], targetduedate: Date.UTC(2026, 10, 18) })!, missingSince: null };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
    mirror: m,
    client: { status: "ready", firmClientId: "fc", clientCode: "ACME" },
    personOf: (id) => ({ ta: "u-a", tr: "u-r" })[id] ?? null,
    rules: RULES,
    job: null,
    ...over,
  });
  const now = new Date("2026-11-06T00:00:00Z");

  it("creates with the statutory due date from the calendar rule", () => {
    const p = planTask(ctx({ statutoryDue: (rule, fy, period) => (rule === "gstr-3b" && fy === "2026-27" && period === "2026-10" ? new Date("2026-11-20T00:00:00Z") : null) }), now);
    expect(p).toMatchObject({ kind: "create", draft: { service: "GST", title: "GSTR-3B", agentless: false, assigneeId: "u-a", reviewerId: "u-r", statutoryDueOn: new Date("2026-11-20T00:00:00Z"), ruleId: "seed-gstr-3b" }, reviewerUnmatched: false });
  });

  it("a rule without an agent, a service without one, and a matched rule with no period are agentless", () => {
    const tds = jobShape({ ...m, taskName: "TDS 26Q Q2 FY 2026-27" }, RULES, now);
    expect(tds).toMatchObject({ service: "TDS", agentless: true, agentlessWhy: "rule without agent" });
    const noAgent = jobShape(m, RULES.map((r) => ({ ...r, service: "Engagement" as const })), now);
    expect(noAgent).toMatchObject({ agentless: true, agentlessWhy: "no agent for service" });
    const noPeriod = jobShape({ ...m, taskName: "GSTR-3B", dueOn: null, turiaCreatedOn: null }, RULES, now);
    expect(noPeriod).toMatchObject({ agentless: true, agentlessWhy: "no period", period: "2026-11", title: "GSTR-3B (TSK1)" });
    expect(agentlessTitle({ taskName: "x".repeat(200), identity: null, id: "99" })).toHaveLength(120);
  });

  it("waits for mappings, and makes no job for a closed task", () => {
    expect(planTask(ctx({ client: { status: "unmatched" } }), now)).toEqual({ kind: "wait", reason: "client-unmatched" });
    expect(planTask(ctx({ client: { status: "ignored" } }), now)).toEqual({ kind: "wait", reason: "client-ignored" });
    expect(planTask(ctx({ mirror: { ...m, assignees: [] } }), now)).toEqual({ kind: "wait", reason: "no-assignee" });
    expect(planTask(ctx({ personOf: () => null }), now)).toEqual({ kind: "wait", reason: "assignee-unmatched" });
    expect(planTask(ctx({ mirror: { ...m, status: "3" } }), now)).toEqual({ kind: "wait", reason: "closed-in-turia" });
    expect(planTask(ctx({ mirror: { ...m, missingSince: now } }), now)).toEqual({ kind: "wait", reason: "closed-in-turia" });
    expect(planTask(ctx({ personOf: (id) => (id === "ta" ? "u-a" : null) }), now)).toMatchObject({ kind: "create", reviewerUnmatched: true });
  });

  it("updates a linked job only towards Turia, and not a DONE one", () => {
    const job = { id: "j", state: "IN_PREP" as const, assigneeId: "u-a", reviewerId: "u-r", internalDueOn: m.dueOn, turiaMissingAt: null, turiaNote: null, hasPullClose: false };
    expect(planTask(ctx({ job }), now)).toEqual({ kind: "nothing", jobId: "j" });
    expect(jobChanges({ ...job, state: "DONE", assigneeId: "x" }, ctx(), now)).toEqual([]);
    expect(planTask(ctx({ job, mirror: { ...m, status: "3" } }), now)).toEqual({ kind: "update", jobId: "j", changes: [], complete: true });
    expect(planTask(ctx({ job: { ...job, hasPullClose: true }, mirror: { ...m, status: "3" } }), now)).toEqual({ kind: "nothing", jobId: "j" });
  });
});

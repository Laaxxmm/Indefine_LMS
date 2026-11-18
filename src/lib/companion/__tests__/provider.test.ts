// The companion's job selection (who sees which jobs, in what order) and the task it builds:
// steps with the current one marked, checklist, copy values (masking), link, queue, counts.
import { describe, expect, it } from "vitest";
import { MSG } from "../messages";
import { actionFor, compareJobs, createCompanionProvider, dbNextTaskSource, isOverdue, whyFor, type NextTaskSource, type RankedJob } from "../provider";
import { asSession, fakeDb, job, user, type JobRow } from "./fakes";

const NOW = new Date("2026-11-05T06:30:00Z"); // 05 Nov 2026, 12:00 IST
const d = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

const staff = asSession(user({ id: "u-staff" }));
const reviewer = asSession(user({ id: "u-reviewer" }));
const manager = asSession(user({ id: "u-manager", level: "MANAGER" }));
const partner = asSession(user({ id: "u-partner", level: "PARTNER" }));
const inactive = asSession(user({ id: "u-staff", active: false }));

const run = (over: Partial<JobRow["runs"][number]> = {}) => ({ id: "run-1", agent: "gst", status: "AGENT_DONE", startedAt: new Date("2026-11-01T05:00:00Z"), figures: null, checklist: [], ...over });

describe("actionFor — what the person can do now (the 'Waiting for you' rules + human-only close-loop steps)", () => {
  const at = (state: JobRow["state"], over: Partial<JobRow> = {}) => ({ ...job({ state, ...over }) });

  it("the preparer: collect, prepare, check, file, close", () => {
    expect(actionFor(staff, at("ASSIGNED"), 0, false, NOW)).toBe("collect");
    expect(actionFor(staff, at("IN_PREP"), 0, false, NOW)).toBe("prepare");
    expect(actionFor(staff, at("AGENT_DONE"), 0, false, NOW)).toBe("check");
    expect(actionFor(staff, at("IN_REVIEW"), 0, false, NOW)).toBeNull(); // cannot review own work
    expect(actionFor(staff, at("APPROVED"), 0, false, NOW)).toBe("file");
    expect(actionFor(staff, at("FILED_BY_HUMAN"), 0, false, NOW)).toBe("close");
    expect(actionFor(staff, at("CLOSING"), 0, false, NOW)).toBe("close");
    expect(actionFor(staff, at("CLOSING"), 0, true, NOW)).toBeNull(); // Turia close already recorded
    expect(actionFor(staff, at("DONE"), 0, false, NOW)).toBeNull();
    expect(actionFor(staff, at("DRAFT"), 0, false, NOW)).toBeNull();
  });

  it("a staff reviewer acts only on IN_REVIEW; never on the preparer's or the filing steps", () => {
    for (const s of ["ASSIGNED", "IN_PREP", "AGENT_DONE", "APPROVED", "FILED_BY_HUMAN", "CLOSING"] as const) expect(actionFor(reviewer, at(s), 0, false, NOW)).toBeNull();
    expect(actionFor(reviewer, at("IN_REVIEW"), 0, false, NOW)).toBe("review");
  });

  it("a manager who reviews may also prepare (as on /agents), but files only as the assignee", () => {
    const j = (s: JobRow["state"]) => at(s, { reviewerId: "u-manager" });
    expect(actionFor(manager, j("ASSIGNED"), 0, false, NOW)).toBe("collect");
    expect(actionFor(manager, j("IN_REVIEW"), 0, false, NOW)).toBe("review");
    expect(actionFor(manager, j("APPROVED"), 0, false, NOW)).toBeNull();
  });

  it("an inactive person has nothing to do", () => {
    expect(actionFor(inactive, at("ASSIGNED"), 0, false, NOW)).toBeNull();
  });
});

describe("ordering", () => {
  const key = (id: string, o: Partial<{ overdue: boolean; internalDueOn: Date | null; statutoryDueOn: Date | null; createdAt: Date }> = {}) => ({
    id,
    overdue: false,
    internalDueOn: null,
    statutoryDueOn: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...o,
  });

  it("overdue first, then internal due, then statutory due, missing dates last, then oldest", () => {
    const keys = [
      key("no-dates-new", { createdAt: new Date("2026-10-05T00:00:00Z") }),
      key("no-dates-old"),
      key("stat-only", { statutoryDueOn: d("2026-11-11") }),
      key("internal-late", { internalDueOn: d("2026-11-20") }),
      key("internal-soon", { internalDueOn: d("2026-11-07"), statutoryDueOn: d("2026-11-11") }),
      key("internal-soon-earlier-stat", { internalDueOn: d("2026-11-07"), statutoryDueOn: d("2026-11-10") }),
      key("overdue", { overdue: true, internalDueOn: d("2026-11-03") }),
      key("overdue-older", { overdue: true, internalDueOn: d("2026-11-01") }),
    ];
    expect([...keys].sort(compareJobs).map((k) => k.id)).toEqual([
      "overdue-older",
      "overdue",
      "internal-soon-earlier-stat",
      "internal-soon",
      "internal-late",
      "stat-only",
      "no-dates-old",
      "no-dates-new",
    ]);
  });

  it("overdue means a due day before today in IST, on either date", () => {
    expect(isOverdue({ internalDueOn: d("2026-11-04"), statutoryDueOn: null }, NOW)).toBe(true);
    expect(isOverdue({ internalDueOn: d("2026-11-05"), statutoryDueOn: null }, NOW)).toBe(false); // due today is not overdue
    expect(isOverdue({ internalDueOn: d("2026-11-08"), statutoryDueOn: d("2026-11-04") }, NOW)).toBe(true);
    expect(isOverdue({ internalDueOn: null, statutoryDueOn: null }, NOW)).toBe(false);
    // 00:30 IST on 05 Nov is still 04 Nov in UTC, but it is today in IST: not overdue.
    expect(isOverdue({ internalDueOn: new Date("2026-11-04T19:00:00Z"), statutoryDueOn: null }, NOW)).toBe(false);
  });

  it("explains why in plain sentences", () => {
    expect(whyFor({ internalDueOn: d("2026-11-03"), statutoryDueOn: d("2026-11-11"), overdue: true }, 4, NOW)).toBe("Overdue: the internal due date was 03 Nov 2026. It is the most overdue of your 4 open jobs.");
    expect(whyFor({ internalDueOn: d("2026-11-03"), statutoryDueOn: d("2026-11-04"), overdue: true }, 2, NOW)).toBe("Overdue: the statutory due date was 04 Nov 2026. It is the most overdue of your 2 open jobs.");
    expect(whyFor({ internalDueOn: d("2026-11-07"), statutoryDueOn: d("2026-11-11"), overdue: false }, 3, NOW)).toBe("Internal due 07 Nov 2026, statutory due 11 Nov 2026. It is due soonest of your 3 open jobs.");
    expect(whyFor({ internalDueOn: null, statutoryDueOn: d("2026-11-11"), overdue: false }, 1, NOW)).toBe("Statutory due 11 Nov 2026. It is the only job waiting for you.");
    expect(whyFor({ internalDueOn: null, statutoryDueOn: null, overdue: false }, 2, NOW)).toBe("No due date is set. It has waited longest of your 2 open jobs.");
  });
});

describe("dbNextTaskSource — visibility per role", () => {
  const world = () =>
    fakeDb({
      jobs: [
        job({ id: "mine-later", internalDueOn: d("2026-11-20") }),
        job({ id: "mine-overdue", state: "IN_PREP", internalDueOn: d("2026-11-02") }),
        job({ id: "mine-soon", state: "APPROVED", internalDueOn: d("2026-11-07") }),
        job({ id: "review-me", state: "IN_REVIEW", internalDueOn: d("2026-11-06") }),
        job({ id: "others", assigneeId: "u-other", reviewerId: "u-other2", internalDueOn: d("2026-11-01") }),
        job({ id: "done", state: "DONE", internalDueOn: d("2026-10-01") }),
      ],
    });

  it("staff see only jobs they prepare or review and can act on, best first", async () => {
    const db = world();
    const ranked = await dbNextTaskSource(db as never).rank(staff, NOW);
    expect(ranked.map((r) => r.jobId)).toEqual(["mine-overdue", "mine-soon", "mine-later"]);
    expect(ranked[0]).toMatchObject({ action: "prepare", part: "Preparer", overdue: true, clientCode: "ACME", clientName: "Acme Traders Private Limited" });
    const where = (db.calls.find((c) => c.model === "jobTask")!.args as { where: unknown }).where;
    expect(where).toEqual({ AND: [{ OR: [{ assigneeId: "u-staff" }, { reviewerId: "u-staff" }] }, { state: { in: ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING"] } }] });
  });

  it("the reviewer sees only the pack waiting for review", async () => {
    const ranked = await dbNextTaskSource(world() as never).rank(reviewer, NOW);
    expect(ranked.map((r) => [r.jobId, r.action, r.part])).toEqual([["review-me", "review", "Reviewer"]]);
  });

  it("partners and managers get their own queue, not the whole firm's", async () => {
    expect(await dbNextTaskSource(world() as never).rank(partner, NOW)).toEqual([]);
    expect(await dbNextTaskSource(world() as never).rank(manager, NOW)).toEqual([]);
  });

  it("block failures on the latest run do not hide a job; a recorded Turia close does", async () => {
    const db = fakeDb({
      jobs: [
        job({ id: "closing", state: "CLOSING", turiaClosed: true }),
        job({ id: "check", state: "AGENT_DONE", runs: [run({ checklist: [{ severity: "block", status: "fail" }] })] }),
      ],
    });
    expect((await dbNextTaskSource(db as never).rank(staff, NOW)).map((r) => r.jobId)).toEqual(["check"]);
  });
});

describe("createCompanionProvider — the task response", () => {
  const approvedFigures = { outwardTaxablePaise: 12345678, netCashPayablePaise: -50, invoiceCount: 41 };

  it("builds the GST filing task: steps with the current one marked, checklist, copy values, link, queue", async () => {
    const db = fakeDb({
      jobs: [
        job({
          id: "gst-1",
          state: "APPROVED",
          internalDueOn: d("2026-11-07"),
          statutoryDueOn: d("2026-11-11"),
          runs: [
            run({ id: "run-2", status: "APPROVED", figures: approvedFigures, startedAt: new Date("2026-11-03T05:00:00Z"), checklist: [{ severity: "warn", status: "fail" }] }),
            run({ id: "run-1", status: "CHANGES_REQUESTED", figures: { outwardTaxablePaise: 1 } }),
          ],
        }),
        job({ id: "later-1", title: "GSTR-1", internalDueOn: d("2026-11-09") }),
        job({ id: "later-2", title: "Books close", service: "Books", internalDueOn: d("2026-11-12") }),
      ],
    });
    const res = await createCompanionProvider({ db: db as never }).nextTask(staff, NOW);
    if (res.status !== "task") throw new Error("expected a task");
    const { task } = res;
    expect(res.generatedAt).toBe(NOW.toISOString());
    expect(task.jobId).toBe("gst-1");
    expect(task.job).toEqual({ title: "GSTR-3B", service: "GST", serviceLabel: "GST", period: "2026-10", fy: "2026-27", state: "APPROVED", clientName: "Acme Traders Private Limited", clientCode: "ACME" });
    expect(task.part).toBe("Preparer");
    expect(task.why).toBe("Internal due 07 Nov 2026, statutory due 11 Nov 2026. It is due soonest of your 3 open jobs.");
    expect(task.nextAction).toBe("File it on the GST portal yourself, then mark it filed in Firm OS.");
    expect(task.due).toEqual({ internal: "07 Nov 2026", statutory: "11 Nov 2026", overdue: false });

    expect(task.steps).toHaveLength(7);
    expect(task.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(task.steps.filter((s) => s.current).map((s) => s.n)).toEqual([5]);
    expect(task.currentStep).toBe(5);
    expect(task.steps.filter((s) => s.done).map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(task.steps[4]).toMatchObject({ where: "portal" });
    expect(task.steps[4].text).toMatch(/yourself.*Firm OS never files/);
    expect(task.steps[1].text).toContain("GST Prep");

    expect(task.checklist).toContain("Signed in to the GST portal for the right client (GSTIN ending F1Z5)");
    expect(task.checklist).toContain("Period selected is 2026-10");
    expect(task.checklist.length).toBeLessThanOrEqual(5);

    const byKey = Object.fromEntries(task.values.map((v) => [v.key, v]));
    expect(byKey.clientName).toMatchObject({ copy: "Acme Traders Private Limited" });
    expect(byKey.clientCode).toMatchObject({ copy: "ACME" });
    expect(byKey.gstin).toMatchObject({ copy: "29ABCDE1234F1Z5", display: "29ABCDE1234F1Z5" }); // the SOP pastes it
    expect(byKey.pan).toBeUndefined();
    expect(byKey.cin).toBeUndefined();
    expect(byKey.period).toMatchObject({ copy: "2026-10" });
    // Amounts only from the APPROVED run; copy is plain, display is ₹ with Indian grouping.
    expect(byKey["figure:outwardTaxablePaise"]).toMatchObject({ label: "Outward taxable", copy: "123456.78", display: "₹1,23,456.78" });
    expect(byKey["figure:netCashPayablePaise"]).toMatchObject({ copy: "-0.50" });
    expect(byKey["figure:invoiceCount"]).toBeUndefined(); // counts are not amounts

    expect(task.link).toEqual({ path: "/agents/gst/runs/run-2", label: "Open in Firm OS" });
    expect(res.later.map((l) => [l.jobId, l.title, l.due])).toEqual([
      ["later-1", "GSTR-1", "09 Nov 2026"],
      ["later-2", "Books close", "12 Nov 2026"],
    ]);
    expect(res.counts).toEqual({ open: 3, overdue: 0 });
  });

  it("never sends a PAN in full; income-tax jobs show it masked to the last 4 and not copyable", async () => {
    const db = fakeDb({ jobs: [job({ id: "itr", service: "IncomeTax", title: "ITR-6", period: "Annual", state: "APPROVED" })] });
    const res = await createCompanionProvider({ db: db as never }).nextTask(staff, NOW);
    const json = JSON.stringify(res);
    expect(json).not.toContain("ABCDE1234F\""); // the bare PAN
    expect(json).not.toContain("29ABCDE1234F1Z5"); // GSTIN only for GST jobs
    if (res.status !== "task") throw new Error("expected a task");
    expect(res.task.values.find((v) => v.key === "pan")).toEqual({ key: "pan", label: "PAN", copy: null, display: "••••••234F", note: "Last 4 only, for checking that the right client is open." });
    expect(res.task.nextAction).toBe("File it on the Income-tax e-filing portal yourself, then mark it filed in Firm OS.");
  });

  it("ROC filing copies the CIN; a preparing job copies no amounts and links to Agents when no run exists", async () => {
    const roc = await createCompanionProvider({ db: fakeDb({ jobs: [job({ service: "ROC", title: "AOC-4", state: "APPROVED" })] }) as never }).nextTask(staff, NOW);
    if (roc.status !== "task") throw new Error("expected a task");
    expect(roc.task.values.find((v) => v.key === "cin")?.copy).toBe("U12345KA2020PTC123456");

    const prep = await createCompanionProvider({
      db: fakeDb({ jobs: [job({ state: "IN_PREP", runs: [run({ status: "APPROVED", figures: { outwardTaxablePaise: 100 } })] })] }) as never,
    }).nextTask(staff, NOW);
    if (prep.status !== "task") throw new Error("expected a task");
    expect(prep.task.values.some((v) => v.key.startsWith("figure:"))).toBe(false);
    expect(prep.task.currentStep).toBe(2);

    const fresh = await createCompanionProvider({ db: fakeDb({ jobs: [job({ state: "ASSIGNED" })] }) as never }).nextTask(staff, NOW);
    if (fresh.status !== "task") throw new Error("expected a task");
    expect(fresh.task.link.path).toBe("/agents");
    expect(fresh.task.currentStep).toBe(1);
    expect(fresh.task.steps.some((s) => s.done)).toBe(false);
  });

  it("nothing to do → You're all caught up.", async () => {
    const res = await createCompanionProvider({ db: fakeDb() as never }).nextTask(staff, NOW);
    expect(res).toEqual({ status: "none", generatedAt: NOW.toISOString(), message: MSG.caughtUp, counts: { open: 0, overdue: 0 } });
    expect(MSG.caughtUp).toBe("You're all caught up.");
  });

  it("a swapped-in source cannot widen what the person sees: details are re-read in their own scope", async () => {
    const db = fakeDb({ jobs: [job({ id: "not-mine", assigneeId: "u-other", reviewerId: "u-other2" }), job({ id: "mine" })] });
    const leaky: NextTaskSource = {
      rank: async () =>
        ["not-mine", "mine"].map(
          (jobId): RankedJob => ({ jobId, title: "GSTR-3B", service: "GST", period: "2026-10", fy: "2026-27", state: "ASSIGNED", clientName: "X", clientCode: "X", part: "Preparer", action: "collect", internalDueOn: null, statutoryDueOn: null, overdue: false }),
        ),
    };
    const res = await createCompanionProvider({ db: db as never, source: leaky }).nextTask(staff, NOW);
    if (res.status !== "task") throw new Error("expected a task");
    expect(res.task.jobId).toBe("mine");
    const detail = db.calls.filter((c) => c.method === "findFirst").map((c) => c.args);
    expect(detail[0]).toMatchObject({ where: { id: "not-mine", OR: [{ assigneeId: "u-staff" }, { reviewerId: "u-staff" }] } });
  });

  it("only reads: the provider never calls a write method", async () => {
    const db = fakeDb({ jobs: [job({ state: "APPROVED", runs: [run({ status: "APPROVED", figures: { aPaise: 1 } })] })] });
    await createCompanionProvider({ db: db as never }).nextTask(staff, NOW);
    expect(db.calls.map((c) => c.method).every((m) => m.startsWith("find"))).toBe(true);
  });
});

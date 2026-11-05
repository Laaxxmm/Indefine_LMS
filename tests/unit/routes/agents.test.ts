// Route smoke for the /agents pages and the mistake log: full server render behind a mocked
// session, against the in-memory echo world as the database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { NotFoundSignal, redirectTarget, renderHtml as renderRaw } from "./harness";
import { echoWorld, rows, user, type World } from "../../fakes/agent-world";
import { ECHO_EXTRACT_TASK } from "@/lib/agents/echo";
import { approvePack, logMistake, requestChanges, startAgentRun, submitForReview } from "@/lib/agents/service";

const state = vi.hoisted(() => ({ world: null as unknown as World, turia: [] as Record<string, unknown>[] }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
// The memory db has no TuriaSync table; the review page's close-loop view reads it, so add one.
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    const turiaSync = { findMany: async ({ where }: { where: { jobTaskId: string } }) => state.turia.filter((r) => r.jobTaskId === where.jobTaskId) };
    return Object.assign(Object.create(state.world.db), { turiaSync });
  },
}));

const { auth } = await import("@/lib/auth");
const { default: Layout } = await import("@/app/agents/layout");
const { default: RunsPage } = await import("@/app/agents/page");
const { default: AgentPage } = await import("@/app/agents/[agent]/page");
const { default: ReviewPage } = await import("@/app/agents/[agent]/runs/[id]/page");
const { default: MistakesPage } = await import("@/app/agents/mistakes/page");
const { default: AdminMistakesPage } = await import("@/app/admin/firm-os/mistakes/page");

const as = (u: Session["user"] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const review = async (id: string) => renderHtml(await ReviewPage({ params: Promise.resolve({ agent: "echo", id }) }));
/** HTML with React's text-node separators removed, so assertions read like the page. */
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const PORTAL_OR_SEND = />\s*(Submit to portal|Send[^<]*|File on portal)\s*</i;

beforeEach(() => {
  state.world = echoWorld();
  state.turia = [];
  state.world.db.seed("user", [
    { id: "u-ravi", name: "Ravi Kumar", email: "ravi@indefine.test" },
    { id: "u-priya", name: "Priya S", email: "priya@indefine.test" },
  ]);
  vi.stubEnv("FIRM_OS_ECHO_AGENT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("signed out / no access", () => {
  it("redirects every page to sign-in", async () => {
    as(null);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => RunsPage())).toBe("/");
    expect(await redirectTarget(() => AgentPage({ params: Promise.resolve({ agent: "echo" }) }))).toBe("/");
    expect(await redirectTarget(() => ReviewPage({ params: Promise.resolve({ agent: "echo", id: "x" }) }))).toBe("/");
    expect(await redirectTarget(() => MistakesPage())).toBe("/");
    expect(await redirectTarget(() => AdminMistakesPage())).toBe("/");
  });
  it("deactivated users go back to the dashboard; staff cannot open the mistake log; non-admins not the admin copy", async () => {
    as(user("priya", { active: false }));
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard");
    as(user("priya"));
    expect(await redirectTarget(() => MistakesPage())).toBe("/agents");
    expect(await redirectTarget(() => AdminMistakesPage())).toBe("/dashboard");
  });
});

describe("/agents", () => {
  it("layout: nav with the visible agents; staff see 'My runs' and no mistake log", async () => {
    as(user("priya"));
    const html = await renderHtml(await Layout({ children: null }));
    expect(html).toContain('aria-label="Agents"');
    expect(html).toContain("My runs");
    expect(html).toContain('href="/agents/echo"');
    expect(html).not.toContain("Mistake log");
    as(user("partner"));
    expect(await renderHtml(await Layout({ children: null }))).toContain("Mistake log");
  });

  it("empty run list", async () => {
    as(user("priya"));
    expect(await renderHtml(await RunsPage())).toContain("No agent runs yet");
  });

  it("staff see only their runs; partners see all", async () => {
    as(user("priya"));
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    expect(await renderHtml(await RunsPage())).toContain('href="/agents/echo/runs/run-1"');
    as(user("outsider"));
    const outsider = await renderHtml(await RunsPage());
    expect(outsider).not.toContain("run-1");
    expect(outsider).toContain("No agent runs yet");
    as(user("partner"));
    const html = await renderHtml(await RunsPage());
    expect(html).toContain("Agent runs");
    expect(html).toContain("AGENT DONE");
    expect(html).toContain("05 Nov 2026");
    expect(html).toContain("IST");
  });

  it("/agents/[agent]: jobs ready for the assignee with Run agent; 404 for an unknown or hidden agent", async () => {
    as(user("priya"));
    const html = await renderHtml(await AgentPage({ params: Promise.resolve({ agent: "echo" }) }));
    expect(html).toContain("Jobs ready for the agent");
    expect(html).toContain("Run agent");
    expect(html).toContain("ASSIGNED");
    as(user("ravi"));
    expect(await renderHtml(await AgentPage({ params: Promise.resolve({ agent: "echo" }) }))).toContain("Nothing to run");
    await expect(AgentPage({ params: Promise.resolve({ agent: "gst" }) })).rejects.toBeInstanceOf(NotFoundSignal);
    vi.stubEnv("FIRM_OS_ECHO_AGENT", "");
    await expect(AgentPage({ params: Promise.resolve({ agent: "echo" }) })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

describe("/agents/[agent]/runs/[id] review screen", () => {
  it("assignee after the run: checklist with evidence, figures in ₹, deliverable, Submit for review — no portal or send action", async () => {
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    as(user("priya"));
    const html = await review("run-1");
    expect(html).toContain("Echo register — Acme Pvt Ltd (ACME01)");
    expect(html).toContain("Checklist");
    expect(html).toContain("“Acme Traders”");
    expect(html).toContain("register.csv row 2");
    expect(html).toContain("₹47,456.49");
    expect(html).toContain("ACME01_Echo-register_2026-10_v1.xlsx");
    expect(html).toContain("Submit for review");
    expect(html).not.toContain("Approve pack");
    expect(html).not.toMatch(PORTAL_OR_SEND);
  });

  it("reviewer on IN_REVIEW: Approve pack (primary) + Request changes; block findings shown in red", async () => {
    state.world = echoWorld({ responses: { [ECHO_EXTRACT_TASK]: { rows: [{ ref: "A", party: "P", date: "2026-10-05", amountPaise: 100 }, { ref: "A", party: "P", date: "2026-10-06", amountPaise: 100 }] } } });
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    await submitForReview(user("priya"), "run-1", state.world.deps);
    as(user("partner"));
    const html = await review("run-1");
    expect(html).toContain("Approve pack");
    expect(html).toContain("Request changes");
    expect(html).toContain("Block:");
    expect(html).toContain("1 block");
    expect(html).toContain("Check by hand"); // the LLM rule had no recording
    expect(html).not.toMatch(PORTAL_OR_SEND);
  });

  it("superseded run is read-only; approved run says a person files it; comments show names", async () => {
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    await submitForReview(user("priya"), "run-1", state.world.deps);
    await requestChanges(user("ravi"), "run-1", "Recheck", state.world.deps);
    await submitForReview(user("priya"), "run-2", state.world.deps);
    await approvePack(user("ravi"), "run-2", null, state.world.deps);
    await state.world.deps.db.auditEvent.create({ data: { actorId: "u-ravi", action: "comment", entity: "AgentRun", entityId: "run-2", meta: { text: "Checked INV-2" } } });
    as(user("ravi"));
    const old = await review("run-1");
    expect(old).toContain("A newer run exists");
    expect(old).not.toContain("Approve pack");
    const done = await review("run-2");
    expect(done).toContain("Reviewer notes for this run");
    expect(done).toContain("Firm OS never files anything");
    expect(done).toContain("Ravi Kumar");
    expect(done).toContain("Final · v2"); // attempt 2 → Working _v2 → Final _v2
    // The reviewer may record the filing: Mark filed is the bar's one action; nothing files or sends.
    expect(done).toContain("Filing and close");
    expect(done).toContain("Filed by you on the portal — record the acknowledgement here.");
    expect(done).toMatch(/<button[^>]*>Mark filed<\/button>/);
    expect(done).not.toMatch(PORTAL_OR_SEND);
    expect(old).not.toContain("Mark filed"); // superseded run: read-only
  });

  it("close loop on the review screen: CLOSING shows Close in Turia and the gate's reasons; DONE shows the chip; admin gets no action", async () => {
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    await submitForReview(user("priya"), "run-1", state.world.deps);
    await approvePack(user("ravi"), "run-1", null, state.world.deps);
    as(user("admin"));
    const admin = await review("run-1");
    expect(admin).toContain("Filing and close");
    expect(admin).not.toContain("Mark filed");
    expect(admin).toContain("A person files it on the portal");

    const db = state.world.db;
    const job = rows(db, "jobTask")[0];
    await db.jobTaskEvent.create({ data: { jobTaskId: "job-1", fromState: "APPROVED", toState: "FILED_BY_HUMAN", actorId: "u-priya", note: "ack ref BOOKS-1" } });
    await db.jobTaskEvent.create({ data: { jobTaskId: "job-1", fromState: "FILED_BY_HUMAN", toState: "CLOSING", actorId: "system:close-loop-hook", note: null } });
    Object.assign(job, { state: "CLOSING", filedAt: new Date(), filedById: "u-priya", ackRef: "BOOKS-1" });
    await db.auditEvent.create({ data: { actorId: "u-priya", action: "close-refused", entity: "JobTask", entityId: "job-1", meta: { reasons: ["Turia task not closed: enter the Turia task ref and minutes logged"], state: "CLOSING" } } });
    as(user("priya"));
    const closing = await review("run-1");
    expect(closing).toMatch(/<button[^>]*>Close in Turia<\/button>/);
    expect(closing).toContain("Still closing: the close gate did not pass");
    expect(closing).toContain("Turia task not closed");
    expect(closing).toContain("BOOKS-1");
    expect(closing).not.toMatch(PORTAL_OR_SEND);

    state.turia.push({ jobTaskId: "job-1", operation: "closeTask", status: "CLOSED", turiaRef: "TT-9", minutesLogged: 40, updatedAt: new Date() });
    expect(await review("run-1")).toMatch(/<button[^>]*>Check again<\/button>/);

    await db.jobTaskEvent.create({ data: { jobTaskId: "job-1", fromState: "CLOSING", toState: "DONE", actorId: "system:close-gate", note: null } });
    Object.assign(job, { state: "DONE", doneAt: new Date("2026-11-05T09:00:00Z") });
    const done = await review("run-1");
    expect(done).toContain("Closed 05 Nov 2026 14:30 IST · cycle time");
    expect(done).not.toContain("Close in Turia");
    expect(done).not.toContain("Still closing");
    expect(done).not.toMatch(PORTAL_OR_SEND);
  });

  it("failed run shows the error and Run agent for the assignee; hidden from outsiders; wrong agent segment 404", async () => {
    state.world = echoWorld({ register: null });
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    as(user("priya"));
    const html = await review("run-1");
    expect(html).toContain("The agent could not finish this run");
    expect(html).toContain("register.csv is missing");
    expect(html).toContain("Run agent");
    as(user("outsider"));
    await expect(review("run-1")).rejects.toBeInstanceOf(NotFoundSignal);
    as(user("priya"));
    await expect(ReviewPage({ params: Promise.resolve({ agent: "gst", id: "run-1" }) })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

describe("mistake log pages", () => {
  it("partner sees proposed rules with the pack diff and Approve rule; admin copy renders the same list", async () => {
    await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
    await logMistake(
      user("ravi"),
      "run-1",
      { finding: "Missed the big invoice", ruleProposal: { id: "echo.big", title: "Big invoices", severity: "warn", kind: "deterministic", check: "echo.amount-over", evidence: "row", params: { limitPaise: 2000000 } } },
      state.world.deps,
    );
    as(user("partner"));
    const html = await renderHtml(await MistakesPage());
    expect(html).toContain("Waiting for a decision (1)");
    expect(html).toContain("Missed the big invoice");
    expect(html).toContain("v1.0.0 → v1.1.0");
    expect(html).toContain("echo.amount-over");
    expect(html).toContain("Approve rule");
    expect(html).toContain("Ravi Kumar");
    as(user("admin"));
    const admin = await renderHtml(await AdminMistakesPage());
    expect(admin).toContain("Missed the big invoice");
    expect(admin).not.toContain("Approve rule");
    expect(admin).toContain("Only a partner or manager can approve or reject.");
  });
});

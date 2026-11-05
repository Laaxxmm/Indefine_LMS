// /workspace/[jobId]: split view per state — sticky panel (job, SOP steps with the current one,
// checklist, open questions, next action) and the tabbed viewer (deliverables via the existing
// preview route, client documents opening in a new tab, the SOP pack text); stacks on a phone;
// same visibility as /agents; Agents module required; no portal embedding or links.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundSignal, redirectTarget, renderHtml as renderRaw } from "./harness";
import { echoWorld, user, NOW, type World } from "../../fakes/agent-world";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const state = vi.hoisted(() => ({ world: null as unknown as World, setting: null as null | Record<string, unknown>, docs: [] as Record<string, unknown>[] }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return Object.assign(Object.create(state.world.db), {
      workspaceSetting: { findUnique: async () => state.setting },
      roleWorkspaceDefault: { findUnique: async () => null },
      clientDocument: { findMany: async ({ where }: { where: { clientId: string } }) => state.docs.filter((d) => d.clientId === where.clientId) },
    });
  },
}));

const { auth } = await import("@/lib/auth");
const { default: Layout } = await import("@/app/workspace/layout");
const { default: WorkspacePage } = await import("@/app/workspace/[jobId]/page");
const { ModuleOffNotice } = await import("@/app/workspace/ModuleOffNotice");

const as = (u: ReturnType<typeof user> | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const page = async (jobId = "job-1") => renderHtml(await WorkspacePage({ params: Promise.resolve({ jobId }) }));
const PRIMARY = /hover:bg-brand-600/g;

function seedRun(w: World, withFiles = false) {
  w.db.seed("agentRun", [{ id: "run-1", jobTaskId: "job-1", agent: "echo", sopPackVersion: "1.0.0", status: "AGENT_DONE", startedAt: NOW }]);
  if (withFiles) {
    w.db.seed("deliverable", [
      { id: "d1", jobTaskId: "job-1", agentRunId: "run-1", kind: "Working", name: "ACME01_Echo_2026-10_v1.xlsx", spPath: "/x", sha256: "a".repeat(64), sizeBytes: 20480, createdAt: NOW },
    ]);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.world = echoWorld();
  state.setting = null;
  state.docs = [
    { id: "doc-1", clientId: "c1", jobId: null, docType: "PAN", name: "PAN card.pdf", webUrl: "https://srcaassociate.sharepoint.com/sites/x/PAN.pdf", createdAt: new Date("2026-09-03T05:00:00Z") },
  ];
  vi.stubEnv("FIRM_OS_ECHO_AGENT", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("layout", () => {
  it("the Firm OS header (Next task, the runs list, a way back); same access as /agents; Agents module required", async () => {
    as(user("priya"));
    const html = await renderHtml(await Layout({ children: null }));
    expect(html).toContain('aria-label="Firm OS"');
    expect(html).toContain(">Next task</a>");
    expect(html).toContain(">My agent runs</a>");
    expect(html).toContain('href="/dashboard"');
    as(null);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/");
    as(user("priya", { active: false }));
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard");
    as(user("priya"));
    state.setting = { modules: ["learning"], focusMode: null, companionEnabled: false };
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard?module-off=agents");
  });

  it("the dashboard notice says plainly which module is off and what to do", async () => {
    const html = await renderHtml(ModuleOffNotice({ param: "agents" })!);
    expect(html).toContain('role="status"');
    expect(html).toContain("Agents is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.");
    expect(ModuleOffNotice({ param: "nonsense" })).toBeNull();
    expect(ModuleOffNotice({ param: undefined })).toBeNull();
  });
});

describe("split view", () => {
  it("ASSIGNED, the preparer: panel with job, steps, checklist and Run agent; viewer tabs; stacks on a phone", async () => {
    as(user("priya"));
    const html = await page();
    expect(html).toContain(">Echo register</h1>");
    expect(html).toContain("Acme Pvt Ltd (ACME01) · Books");
    expect(html).toContain('aria-label="Run agent: Echo register for ACME01"');
    expect(html.match(PRIMARY)?.length).toBe(1);
    expect(html).toMatch(/<li aria-current="step"[^>]*>.*Run Echo \(framework test\)/);
    expect(html).toContain("Before you move on");
    // Phone: one column, the panel first (above the viewer); large screens: two columns, panel sticky.
    expect(html).toContain('class="grid grid-cols-1 gap-6 items-start lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]"');
    expect(html).toMatch(/<div data-panel="job" class="space-y-6 lg:sticky lg:top-20 lg:self-start/);
    expect(html.indexOf(`data-panel="job"`)).toBeLessThan(html.indexOf(`role="tablist"`));
    expect(html).not.toContain("<aside");
    // Tabs: three, the client documents selected when there are no deliverables.
    expect(html.match(/role="tab"/g)?.length).toBe(3);
    expect(html).toMatch(/aria-selected="true"[^>]*>Client documents/);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(3);
    expect(html).toContain("No agent run yet. The draft pack&#x27;s files appear here after the agent runs.");
    expect(html).toContain('href="/focus"'); // back link
  });

  it("client documents: the period's ClientDocs folder and each document open in a new tab", async () => {
    as(user("priya"));
    const html = await page();
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/Books/2026-10/ClientDocs" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/x/PAN.pdf" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("PAN card.pdf");
    expect(html).toContain("added 03 Sep 2026");
    expect(html).toContain("(opens in a new tab)");
    state.docs = [];
    expect(await page()).toContain("No documents are recorded for this client yet.");
  });

  it("deliverables: the latest run's files through the existing preview and download routes, selected first", async () => {
    state.world = echoWorld({ jobState: "AGENT_DONE" });
    seedRun(state.world, true);
    as(user("priya"));
    const html = await page();
    expect(html).toMatch(/aria-selected="true"[^>]*>Deliverables/);
    expect(html).toContain("ACME01_Echo_2026-10_v1.xlsx");
    expect(html).toContain("Preview</button>");
    expect(html).toContain('href="/api/firm-os/agents/deliverables/d1"');
    expect(html).toContain('href="/agents/echo/runs/run-1"');
    expect(html).toContain("Open pack to submit");
    expect(html).toContain("From attempt 1, started 05 Nov 2026 12:00 IST.");
  });

  it("the SOP pack text: the active published pack's checks by severity", async () => {
    as(user("priya"));
    const html = await page();
    expect(html).toContain("the active published pack");
    expect(html).toMatch(/v1\.0\.0 · the active published pack · \d+ checks the agent runs/);
    expect(html).toContain(">Block</span>");
    expect(html).toContain("Evidence: ");
  });

  it("per state and person: who acts next, or the action; DONE shows every step done", async () => {
    state.world = echoWorld({ jobState: "IN_REVIEW" });
    seedRun(state.world);
    as(user("priya"));
    let html = await page();
    expect(html).toContain("Nothing for you to do here right now. The reviewer is checking the pack.");
    expect(html.match(PRIMARY)).toBeNull();
    as(user("ravi"));
    expect(await page()).toContain(">Review pack</a>");

    state.world = echoWorld({ jobState: "APPROVED" });
    seedRun(state.world);
    as(user("ravi")); // the reviewer may also record the filing from the workspace
    expect(await page()).toContain(">Mark filed</a>");

    state.world = echoWorld({ jobState: "DONE" });
    seedRun(state.world);
    as(user("priya"));
    html = await page();
    expect(html).toContain("This job is DONE. Nothing more is needed.");
    expect(html).not.toContain('aria-current="step"');
    expect(html).toContain("Step 6, done: ");
  });

  it("a GST job: the plain portal note, never a portal link or an embedded frame", async () => {
    state.world = echoWorld({ jobState: "APPROVED", service: "GST" });
    seedRun(state.world);
    as(user("priya"));
    const html = await page();
    expect(html).toContain("Do the filing on the portal in your browser.");
    expect(html).not.toMatch(/gov\.in|<iframe|<embed|<object/);
    expect(html).not.toMatch(/>\s*(Submit to portal|File on portal|Send[^<]*)\s*</i);
  });

  it("a service with no agent: prepare by hand, and no SOP pack to show", async () => {
    state.world = echoWorld({ service: "TDS" });
    vi.stubEnv("FIRM_OS_ECHO_AGENT", "");
    as(user("priya"));
    const html = await page();
    expect(html).toContain("There is no agent for TDS yet. Prepare the work by hand");
    expect(html).toContain("No SOP pack for TDS yet");
    expect(html.match(PRIMARY)).toBeNull();
  });

  it("visibility as on /agents: managers and partners see any job; staff not on the job get a 404", async () => {
    as(user("meera"));
    expect(await page()).toContain(">Echo register</h1>");
    as(user("partner"));
    expect(await page()).toContain(">Echo register</h1>");
    as(user("outsider"));
    await expect(page()).rejects.toBeInstanceOf(NotFoundSignal);
    as(user("priya"));
    await expect(page("no-such-job")).rejects.toBeInstanceOf(NotFoundSignal);
    as(null);
    expect(await redirectTarget(() => WorkspacePage({ params: Promise.resolve({ jobId: "job-1" }) }))).toBe("/");
  });
});

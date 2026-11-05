// /admin/firm-os/cycle-time renders for an admin (empty and with data), and sends others away.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
const loadCycleJobs = vi.fn();
vi.mock("@/lib/close-loop/cycle-time-db", () => ({ loadCycleJobs: (...a: unknown[]) => loadCycleJobs(...a) }));

const { auth } = await import("@/lib/auth");
const { default: CycleTimePage } = await import("@/app/admin/firm-os/cycle-time/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const params = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });

const H = 3_600_000;
const times = (total: number, review: number) => ({ assignedToDone: total * H, queue: 0, prep: (total - review) * H, review: review * H, waitOnClient: 0, filing: 0, filingToDone: 0, done: true });

describe("/admin/firm-os/cycle-time", () => {
  beforeEach(() => {
    signedIn(activeSession({ role: "ADMIN" }));
    prismaCalls.length = 0;
    loadCycleJobs.mockResolvedValue({ jobs: [], capped: false });
  });

  it("renders the empty state with the IST range in DD MMM YYYY", async () => {
    const html = await renderHtml(await CycleTimePage(params({ from: "2026-10-01", to: "2026-10-31" })));
    expect(html).toContain("Cycle time");
    expect(html).toContain("01 Oct 2026");
    expect(html).toContain("31 Oct 2026");
    expect(html).toContain("No jobs reached DONE in this range.");
    expect(html).toContain('href="/admin"');
    const [from, to] = loadCycleJobs.mock.calls[0] as [Date, Date];
    expect([from.toISOString(), to.toISOString()]).toEqual(["2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
  });

  it("shows median, p90 and the bottleneck per service, person and client", async () => {
    loadCycleJobs.mockResolvedValue({
      capped: true,
      jobs: [
        { jobTaskId: "1", service: "GST", assigneeId: "u1", assigneeName: "Priya Raman", clientCode: "ACME01", times: times(10, 8) },
        { jobTaskId: "2", service: "GST", assigneeId: "u1", assigneeName: "Priya Raman", clientCode: "ACME01", times: times(30, 20) },
      ],
    });
    const html = await renderHtml(await CycleTimePage(params()));
    expect(html).toContain("Priya Raman");
    expect(html).toContain("ACME01");
    expect(html).toContain("20h"); // median of 10h and 30h
    expect(html).toContain("1d 6h"); // p90
    expect(html).toContain("Review");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("first 5,000 jobs");
    expect(html).not.toMatch(/submit to portal/i);
  });

  it("redirects non-admins and signed-out visitors", async () => {
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await redirectTarget(() => CycleTimePage(params()))).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => CycleTimePage(params()))).toBe("/");
  });
});

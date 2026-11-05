// /admin/firm-os/models renders for an admin (empty and with data) with the range in the URL,
// DD MMM YYYY dates (September is "Sep", not the locale's "Sept"), ₹ in Indian grouping and AA
// text colours; everyone else is sent away.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, redirectTarget, renderHtml as renderRaw } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
const loadModelCalls = vi.fn();
vi.mock("@/lib/ai/db", () => ({ loadModelCalls: (...a: unknown[]) => loadModelCalls(...a) }));

const { auth } = await import("@/lib/auth");
const { default: ModelsPage } = await import("@/app/admin/firm-os/models/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const params = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");

describe("/admin/firm-os/models", () => {
  beforeEach(() => {
    signedIn(activeSession({ role: "ADMIN" }));
    loadModelCalls.mockResolvedValue([]);
  });

  it("empty range: the filter keeps the dates (GET form → URL), empty tables say so, dates are DD MMM YYYY", async () => {
    const html = await renderHtml(await ModelsPage(params({ from: "2026-09-01", to: "2026-09-30" })));
    expect(html).toContain(">Model usage</h1>");
    expect(html).toContain("01 Sep 2026 to 30 Sep 2026 (IST)");
    expect(html).not.toContain("Sept");
    expect(html).toMatch(/<form[^>]*method="get"/i);
    expect(html).toContain('name="from" value="2026-09-01"');
    expect(html).toContain('name="to" value="2026-09-30"');
    expect(html).toContain("No model calls in this range.");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("text-ink-faint"); // ~2:1 on white; the Firm OS pages use ink-mute
  });

  it("with calls: cost in ₹ with Indian grouping, per day / agent / provider", async () => {
    loadModelCalls.mockResolvedValue([
      { createdAt: new Date("2026-09-05T06:00:00Z"), agent: "gst", provider: "claude", status: "ok", escalated: false, costInr: 123456.5, tokensIn: 10, tokensOut: 5 },
      { createdAt: new Date("2026-09-05T07:00:00Z"), agent: "gst", provider: "claude", status: "ok", escalated: true, costInr: 10, tokensIn: 10, tokensOut: 5 },
    ]);
    const html = await renderHtml(await ModelsPage(params({ from: "2026-09-01", to: "2026-09-30" })));
    expect(html).toContain("₹1,23,466.50");
    expect(html).toContain("05 Sep 2026");
    expect(html).toContain(">Claude<");
    expect(html).toContain(">gst<"); // no agent registered under that key yet: the key is shown as is
    // Phone width: stat cards stack (a ₹ total overflowed a half-width card at 390px) and the tables'
    // cards may shrink inside the two-column grid (they widened the page to 462px).
    expect(html).toContain("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4");
    expect(html).toMatch(/<section class="[^"]*min-w-0"/);
    expect(html).not.toMatch(/submit to portal/i);
  });

  it("redirects non-admins and signed-out visitors", async () => {
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await redirectTarget(() => ModelsPage(params()))).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => ModelsPage(params()))).toBe("/");
  });
});

// /admin/live/parked: admins only; lists sessions parked by the Gemini gate with what to do, and a
// "Mark reviewed" form per session waiting for review. /admin/live links to it.
import { describe, expect, it, vi } from "vitest";
import { activeSession, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const parked = [
    { id: "a2", entity: "LiveSession", entityId: "ls-2", actorId: "system:gemini-gate", meta: { reasons: ["numbers spoken as words"] }, createdAt: new Date("2026-11-05T06:00:00Z") },
    { id: "a1", entity: "LiveSession", entityId: "ls-1", actorId: "system:gemini-gate", meta: { reasons: ["PAN"] }, createdAt: new Date("2026-11-05T05:00:00Z") },
  ];
  const reviewed = [{ id: "a3", entity: "LiveSession", entityId: "ls-1", actorId: "u-admin", meta: {}, createdAt: new Date("2026-11-05T07:00:00Z") }];
  return {
    prisma: {
      auditEvent: { findMany: async (a: { where: { action: string } }) => (a.where.action === "gemini.parked" ? parked : reviewed), create: async () => ({ id: "x" }) },
      liveSession: {
        findMany: async () => [
          { id: "ls-1", title: "GST refunds walk-through", startAt: new Date("2026-11-03T05:30:00Z"), recordedVideoId: "v-1" },
          { id: "ls-2", title: "TDS basics", startAt: new Date("2026-11-04T05:30:00Z"), recordedVideoId: "v-2" },
        ],
      },
      video: { findMany: async () => [] },
      user: { findMany: async () => [{ id: "u-admin", name: "Asha Admin", email: "asha@indefine.test" }] },
    },
  };
});

const { auth } = await import("@/lib/auth");
const { default: Page } = await import("@/app/admin/live/parked/page");
const as = (o: Parameters<typeof activeSession>[0]) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession(o));
const render = async (sp: Record<string, string> = {}) => (await renderHtml(await Page({ searchParams: Promise.resolve(sp) }))).replace(/<!-- -->/g, "");

describe("/admin/live/parked", () => {
  it("is for admins only", async () => {
    as({ id: "u-staff" });
    expect(await redirectTarget(() => Page({ searchParams: Promise.resolve({}) }))).toBe("/dashboard");
    as({ id: "u-partner", level: "PARTNER" });
    expect(await redirectTarget(() => Page({ searchParams: Promise.resolve({}) }))).toBe("/dashboard");
  });

  it("lists parked sessions with what to do, the video page link, the status and one Mark reviewed form per open session", async () => {
    as({ id: "u-admin", role: "ADMIN" });
    const html = await render();
    expect(html).toContain("Parked for review");
    expect(html).toContain("What to do");
    expect(html).toContain("add the quiz questions by hand");
    expect(html).toContain("GST refunds walk-through");
    expect(html).toContain("TDS basics");
    expect(html).toContain("numbers spoken as words");
    expect(html).toContain('href="/admin/video/v-2"');
    expect(html).toContain("1 waiting for review · 1 reviewed");
    expect(html.match(/>Mark reviewed</g)).toHaveLength(1);
    expect(html).toContain("Reviewed by Asha Admin");
  });

  it("shows a plain confirmation or a fixed error sentence, never text from the address", async () => {
    as({ id: "u-admin", role: "ADMIN" });
    expect(await render({ reviewed: "1" })).toContain("Marked as reviewed.");
    expect(await render({ error: "not-parked" })).toContain("That session is not on the parked list. Refresh the page and try again.");
    expect(await render({ error: "<b>injected</b>" })).not.toContain("injected");
  });
});

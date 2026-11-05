// Header navigation: which link marks the current section, and the admin menu (sidebar on large
// screens, "Admin menu" disclosure below lg) with the Firm OS pages grouped under their heading.
import { describe, expect, it, vi } from "vitest";
import { activeSession, redirectTarget, renderHtml } from "./harness";
import { isCurrentSection } from "@/components/NavLink";
import { isAdminNavActive } from "@/app/admin/AdminNav";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: AdminLayout } = await import("@/app/admin/layout");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

describe("current section", () => {
  it("a section link is current on its page and the pages below it; exact links only on their own page", () => {
    expect(isCurrentSection("/agents/echo", "/agents/echo")).toBe(true);
    expect(isCurrentSection("/agents/echo/runs/run-1", "/agents/echo")).toBe(true);
    expect(isCurrentSection("/agents/echoes", "/agents/echo")).toBe(false);
    expect(isCurrentSection("/agents", "/agents", true)).toBe(true);
    expect(isCurrentSection("/agents/echo", "/agents", true)).toBe(false);
    expect(isCurrentSection("/onboard/", "/onboard")).toBe(true);
    expect(isCurrentSection(null, "/onboard")).toBe(false);
  });

  it("admin menu: Overview only on /admin without a tab; tab items by tab; others by path prefix", () => {
    expect(isAdminNavActive("/admin", "/admin", null)).toBe(true);
    expect(isAdminNavActive("/admin", "/admin", "videos")).toBe(false);
    expect(isAdminNavActive("/admin?tab=videos", "/admin", "videos")).toBe(true);
    expect(isAdminNavActive("/admin/kra", "/admin/kra/u-1", null)).toBe(true);
    expect(isAdminNavActive("/admin/firm-os/models", "/admin/firm-os/models", null)).toBe(true);
    expect(isAdminNavActive("/admin/firm-os/models", "/admin/firm-os/mistakes", null)).toBe(false);
    expect(isAdminNavActive("/admin", "/admin/kra", null)).toBe(false);
  });
});

describe("admin layout", () => {
  it("groups the Firm OS pages under their own heading, labelled with the pages' titles, in both menus", async () => {
    signedIn(activeSession({ role: "ADMIN" }));
    const html = (await renderHtml(await AdminLayout({ children: null }))).replace(/<!-- -->/g, "");
    expect(html).toContain(">Firm OS</p>");
    for (const [href, label] of [
      ["/admin/firm-os/models", "Model usage"],
      ["/admin/firm-os/mistakes", "Mistake log"],
      ["/admin/firm-os/cycle-time", "Cycle time"],
    ]) {
      expect(html.split(`href="${href}"`).length - 1).toBe(2); // sidebar + small-screen menu
      expect(html).toContain(`${label}</a>`);
    }
    expect(html).not.toContain("Mistake log (AI)");
    expect(html).toContain("Admin menu");
  });

  it("sends non-admins to the dashboard", async () => {
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await redirectTarget(() => AdminLayout({ children: null }))).toBe("/dashboard");
  });
});

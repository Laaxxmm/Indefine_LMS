// Smoke: /tools renders behind a signed-in session and bounces signed-out visitors to "/".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: ToolsLayout } = await import("@/app/tools/layout");
const { default: ToolsIndex } = await import("@/app/tools/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

describe("/tools", () => {
  beforeEach(() => signedIn(activeSession()));

  it("renders the tools grid inside the layout for an active user", async () => {
    const page = await ToolsIndex();
    const tree = await ToolsLayout({ children: page });
    const html = await renderHtml(tree);
    expect(html).toContain("Tools");
    expect(html).toContain("Certification generator");
    expect(html).toContain('href="/tools/statutory-updates"');
    expect(html).not.toContain("Neo Centra"); // directors-only card hidden from an executive
  });

  it("redirects a signed-out visitor to sign-in", async () => {
    signedIn(null);
    expect(await redirectTarget(() => ToolsLayout({ children: null }))).toBe("/");
  });

  it("sends an inactive user back to the dashboard", async () => {
    signedIn(activeSession({ active: false }));
    expect(await redirectTarget(() => ToolsLayout({ children: null }))).toBe("/dashboard");
  });
});

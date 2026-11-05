// Smoke: /clients renders behind a signed-in session and bounces signed-out visitors to "/".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: ClientsLayout } = await import("@/app/clients/layout");
const { default: ClientsList } = await import("@/app/clients/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const noParams = () => ({ searchParams: Promise.resolve({}) });

describe("/clients", () => {
  beforeEach(() => {
    signedIn(activeSession());
    prismaCalls.length = 0;
  });

  it("renders the client database (empty state) inside the layout for an active user", async () => {
    const page = await ClientsList(noParams());
    const html = await renderHtml(await ClientsLayout({ children: page }));
    expect(html).toContain("Client database");
    expect(html).toContain("No clients match");
    expect(html).toContain('href="/clients/new"');
    expect(prismaCalls.some((c) => c.model === "client" && c.method === "findMany")).toBe(true);
  });

  it("applies the search filter to the client query", async () => {
    await ClientsList({ searchParams: Promise.resolve({ q: "abcde" }) });
    const call = prismaCalls.find((c) => c.model === "client" && c.method === "findMany");
    expect(JSON.stringify(call?.args)).toContain("ABCDE"); // client-code search is upper-cased
    expect(JSON.stringify(call?.args)).not.toContain("\"pan\""); // never a partial PAN match (client-pii.test.ts)
  });

  it("redirects a signed-out visitor to sign-in (layout and page both guard)", async () => {
    signedIn(null);
    expect(await redirectTarget(() => ClientsLayout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => ClientsList(noParams()))).toBe("/");
  });

  it("sends an inactive user back to the dashboard", async () => {
    signedIn(activeSession({ active: false }));
    expect(await redirectTarget(() => ClientsLayout({ children: null }))).toBe("/dashboard");
  });
});

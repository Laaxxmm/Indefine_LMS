// AreaHeader (the LMS Clients / Tech work / Tools header): the row wraps instead of clipping on a
// phone, the nav is a labelled landmark that scrolls sideways, the current section is marked with
// aria-current and the brand-50 fill, every link has the focus ring, and the area label is AA text.
import { describe, expect, it, vi } from "vitest";
import { renderHtml } from "./routes/harness";

const nav = vi.hoisted(() => ({ path: "/clients" }));
vi.mock("next/navigation", async () => ({ ...(await import("./routes/harness")).navigationMock, usePathname: () => nav.path }));

const { AreaHeader } = await import("@/components/AreaHeader");

const LINKS = [
  { href: "/clients", label: "All clients", except: ["/clients/new", "/clients/reports"] },
  { href: "/clients/new", label: "Onboard" },
  { href: "/clients/reports", label: "Reports" },
];
const html = async (path: string) => {
  nav.path = path;
  return (await renderHtml(<AreaHeader home="/clients" area="Clients" links={LINKS} />)).replace(/<!-- -->/g, "");
};
const link = (out: string, label: string) => out.match(new RegExp(`<a[^>]*>(?:<svg[^]*?</svg>)? ?${label}</a>`))?.[0] ?? "";

describe("AreaHeader", () => {
  it("wraps on a phone: flex-wrap row with a min height, nav scrolls inside its own box", async () => {
    const out = await html("/clients");
    expect(out).toMatch(/class="[^"]*flex flex-wrap[^"]*min-h-16|class="[^"]*min-h-16[^"]*flex flex-wrap/);
    expect(out).not.toContain(" h-16 ");
    expect(out).toMatch(/<nav aria-label="Clients" class="[^"]*overflow-x-auto/);
  });

  it("marks the current section: the page itself, and the area root on a page below it", async () => {
    let out = await html("/clients");
    expect(link(out, "All clients")).toContain('aria-current="page"');
    expect(link(out, "All clients")).toContain("bg-brand-50");
    expect(link(out, "Onboard")).not.toContain("aria-current");

    out = await html("/clients/c1");
    expect(link(out, "All clients")).toContain('aria-current="true"');

    out = await html("/clients/reports");
    expect(link(out, "Reports")).toContain('aria-current="page"');
    expect(link(out, "All clients")).not.toContain("aria-current"); // another link's section
  });

  it("every link has the focus ring; the area label is ink-mute (AA), not ink-faint; the way back to the dashboard", async () => {
    const out = await html("/clients");
    for (const label of ["All clients", "Onboard", "Reports", "Dashboard"]) expect(link(out, label)).toContain("focus-visible:ring-2");
    expect(out).toContain('href="/dashboard"');
    expect(out).toMatch(/text-ink-mute[^"]*">Clients</);
    expect(out).not.toContain("text-ink-faint");
  });
});

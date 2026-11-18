// The dashboard bar (src/lib/workspace/nav.ts dashboardNav): Home, Learn ▾, Tools, Clients,
// Firm OS ▾, Work — each link only when its module is on for the person; the Firm OS menu uses the
// Firm OS header's own labels; a menu with one link left is that link on its own.
import { describe, expect, it } from "vitest";
import { activeSession } from "./routes/harness";
import { MODULE_KEYS, type ModuleKey } from "@/lib/workspace/registry";
import { dashboardLinks, dashboardNav, firmOsNav, type DashboardEntry } from "@/lib/workspace/nav";

const ALL = [...MODULE_KEYS];
const show = (entries: DashboardEntry[]) => entries.map((e) => (e.kind === "link" ? e.item.label : `${e.label} ▾ (${e.items.map((i) => i.label).join(", ")})`));

describe("dashboardNav", () => {
  it("everything on: six entries in the order of the old bar, two of them menus", () => {
    expect(show(dashboardNav(ALL))).toEqual(["Learn ▾ (Courses, Leaderboard, Check-in, Recap)", "Tools", "Clients", "Firm OS ▾ (Next task, Agents, My day, Client messages)", "Work"]);
  });

  it("Firm OS off (no Firm OS module): no Firm OS menu at all; the LMS entries as before", () => {
    const lms: ModuleKey[] = ["learning", "leaderboard", "tools", "clients", "work"];
    expect(show(dashboardNav(lms))).toEqual(["Learn ▾ (Courses, Leaderboard, Check-in, Recap)", "Tools", "Clients", "Work"]);
    expect(dashboardNav(lms).flatMap((e) => (e.kind === "link" ? [e.item.href] : e.items.map((i) => i.href)))).not.toEqual(
      expect.arrayContaining(["/focus", "/agents", "/coach", "/comms"]),
    );
  });

  it("each link only with its module; a menu of one becomes that link", () => {
    expect(show(dashboardNav(["learning", "coach"]))).toEqual(["Courses", "My day"]);
    expect(show(dashboardNav(["coach", "comms"]))).toEqual(["Firm OS ▾ (My day, Client messages)"]);
    expect(show(dashboardNav([]))).toEqual([]);
  });

  it("the Firm OS menu says what the Firm OS header says, for the same places", () => {
    const menu = dashboardNav(ALL).find((e) => e.kind === "menu" && e.group === "firmOs");
    const header = firmOsNav(activeSession({ level: "PARTNER" }).user, ALL, { companion: true }).primary;
    expect(menu?.kind === "menu" && menu.items.map((i) => `${i.label} ${i.href}`)).toEqual(header.map((i) => `${i.label} ${i.href}`));
  });

  it("is dashboardLinks grouped: nothing added or dropped, and the tour anchor kept", () => {
    const flat = dashboardNav(ALL).flatMap((e) => (e.kind === "link" ? [e.item] : e.items));
    expect(flat.map((i) => i.href)).toEqual(dashboardLinks(ALL).map((l) => l.href));
    expect(flat.find((i) => i.href === "/leaderboard")?.tour).toBe("leaderboard");
  });
});

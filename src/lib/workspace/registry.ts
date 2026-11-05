// Workspace modules: the one list of what an admin can switch on or off per role and per person
// (/admin/firm-os/workspace). Pure data — no Prisma, no session, no Next — so client panels can
// import it for labels. Who may use a module at all is NOT decided here: src/lib/workspace/access.ts
// holds the role rules, and a module being switched on never grants access the role does not have.
//
//   learning     Courses, training videos and quizzes (the LMS core)
//   leaderboard  Leaderboard, team view and Trajectory (wizard, check-ins, initiatives, recap)
//   clients      /clients — client database, jobs, documents
//   work         /work — tech work tracker (its own email allow-list still applies)
//   tools        /tools — SOP builder, certificates, office tools, Neo Centra
//   onboard      /onboard — Firm OS plain-English onboarding
//   agents       /agents, /focus, /workspace — task agents, next task, guided workspace
//   coach        /coach — Daily Coach
//   comms        /comms — client message drafts (never sent by the app)
//   search       /search — firm-wide search
//   admin        /admin — admin area (an admin always keeps it: see ALWAYS_ON)
import type { FirmRole } from "@/lib/rbac/policy";

export const MODULE_KEYS = ["learning", "leaderboard", "clients", "work", "tools", "onboard", "agents", "coach", "comms", "search", "admin"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDef = {
  key: ModuleKey;
  /** Shown on the admin page and in the "turned off" message. */
  label: string;
  /** One plain sentence for the admin page. */
  description: string;
  /** Page routes the module owns (a route and everything below it). */
  routes: readonly string[];
  /** API route prefixes behind those pages, for route-level checks. */
  apiRoutes: readonly string[];
};

export const MODULES: readonly ModuleDef[] = [
  {
    key: "learning",
    label: "Learning",
    description: "Courses, training videos and quizzes, and the courses part of the dashboard.",
    routes: ["/video", "/quiz"],
    apiRoutes: ["/api/video", "/api/quiz", "/api/material"],
  },
  {
    key: "leaderboard",
    label: "Leaderboard and Trajectory",
    description: "Leaderboard, team view, growth wizard, weekly check-ins, initiatives and the recap.",
    routes: ["/leaderboard", "/team", "/initiatives", "/checkin", "/recap", "/wizard"],
    apiRoutes: [],
  },
  {
    key: "clients",
    label: "Clients",
    description: "The client database, jobs and client documents.",
    routes: ["/clients"],
    apiRoutes: ["/api/clients"],
  },
  {
    key: "work",
    label: "Work tracker",
    description: "The tech work tracker. Its own allow-list still decides who can open it.",
    routes: ["/work"],
    apiRoutes: ["/api/work"],
  },
  {
    key: "tools",
    label: "Tools",
    description: "SOP builder, certificate generator, office tools and the other tools.",
    routes: ["/tools"],
    apiRoutes: ["/api/tools"],
  },
  {
    key: "onboard",
    label: "Firm OS onboarding",
    description: "Plain-English onboarding of a new client. Partners, managers and admins only.",
    routes: ["/onboard"],
    apiRoutes: ["/api/firm-os/onboard"],
  },
  {
    key: "agents",
    label: "Agents",
    description: "Task agents, the next-task focus page and the guided workspace.",
    routes: ["/agents", "/focus", "/workspace"],
    apiRoutes: ["/api/firm-os/agents", "/api/firm-os/jobs", "/api/firm-os/workspace/next-task"],
  },
  {
    key: "coach",
    label: "Daily Coach",
    description: "The morning board and gentle reminders.",
    routes: ["/coach"],
    apiRoutes: [],
  },
  {
    key: "comms",
    label: "Client comms drafts",
    description: "Drafts of client messages. The app never sends them.",
    routes: ["/comms"],
    apiRoutes: [],
  },
  {
    key: "search",
    label: "Search",
    description: "Search across clients, jobs and packs the person can see.",
    routes: ["/search"],
    apiRoutes: [],
  },
  {
    key: "admin",
    label: "Admin",
    description: "The admin area. Admins only, and an admin always keeps it.",
    routes: ["/admin"],
    apiRoutes: ["/api/admin"],
  },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export const isModuleKey = (k: unknown): k is ModuleKey => typeof k === "string" && BY_KEY.has(k as ModuleKey);

export function moduleDef(key: ModuleKey): ModuleDef {
  return BY_KEY.get(key)!;
}

export const moduleLabel = (key: ModuleKey) => moduleDef(key).label;

/** Known keys only, no repeats, in registry order. */
export function sortModules(keys: Iterable<string>): ModuleKey[] {
  const want = new Set([...keys].filter(isModuleKey));
  return MODULE_KEYS.filter((k) => want.has(k));
}

const under = (path: string, route: string) => path === route || path.startsWith(`${route}/`);

/** The module that owns a page or API path ("/clients/abc" → clients), or null (dashboard, sign-in, …). */
export function moduleForPath(pathname: string): ModuleKey | null {
  const p = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  // Longest route first, so /api/firm-os/workspace/next-task wins over shorter prefixes.
  let best: { key: ModuleKey; len: number } | null = null;
  for (const m of MODULES) {
    for (const r of [...m.routes, ...m.apiRoutes]) {
      if (under(p, r) && (!best || r.length > best.len)) best = { key: m.key, len: r.length };
    }
  }
  return best?.key ?? null;
}

export const FIRM_ROLES: readonly FirmRole[] = ["staff", "manager", "partner", "admin"];

/**
 * Built-in defaults, used until an admin saves a role default (RoleWorkspaceDefault) or a
 * person's own list (WorkspaceSetting). Staff get the Firm OS work modules plus the LMS they use
 * today (learning, leaderboard, work tracker — the tracker's allow-list still applies); managers
 * add clients, comms and onboarding; partners and admins get everything. Access rules apply on top.
 */
const STAFF: readonly ModuleKey[] = ["learning", "leaderboard", "work", "tools", "agents", "coach", "search"];
export const BUILT_IN_ROLE_MODULES: Readonly<Record<FirmRole, readonly ModuleKey[]>> = {
  staff: STAFF,
  manager: sortModules([...STAFF, "clients", "comms", "onboard"]),
  partner: MODULE_KEYS,
  admin: MODULE_KEYS,
};

/** Focus mode is off until an admin turns it on for a role or a person. */
export const BUILT_IN_FOCUS: Readonly<Record<FirmRole, boolean>> = { staff: false, manager: false, partner: false, admin: false };

/** Modules a role always keeps, whatever is saved: an admin can never be locked out of this page. */
export const ALWAYS_ON: Readonly<Record<FirmRole, readonly ModuleKey[]>> = { staff: [], manager: [], partner: [], admin: ["admin"] };

export const ROLE_LABELS: Readonly<Record<FirmRole, string>> = { staff: "Staff", manager: "Manager", partner: "Partner", admin: "Admin" };

export const isFirmRole = (r: unknown): r is FirmRole => typeof r === "string" && (FIRM_ROLES as readonly string[]).includes(r);

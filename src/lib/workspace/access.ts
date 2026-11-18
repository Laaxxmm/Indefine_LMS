// Who may use each workspace module at all — the same predicate the module's own layout or page
// guard uses today. A module switched on in the workspace settings never widens these: the
// effective set is (switched on) AND (allowed here). Composes src/lib/access.ts and the module
// access helpers; never compares role/level strings.
import { isActive, isAdmin, type SessionUser } from "@/lib/access";
import { canUseAgents } from "@/lib/agents/access";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { canViewClients } from "@/lib/clients/core";
import { canOnboard } from "@/lib/rbac/policy";
import { canUseWork } from "@/lib/work/core";
import type { ModuleKey } from "./registry";

const signedIn = (user: SessionUser) => !!user;

/** Mirrors the existing guard of each area (layout or page), so nothing here opens a door. */
const RULES: Readonly<Record<ModuleKey, (user: SessionUser) => boolean>> = {
  learning: signedIn, // /dashboard, /video, /quiz: signed in (quiz also needs active, checked there)
  leaderboard: signedIn, // /leaderboard, /team, /initiatives, /checkin, /recap, /wizard
  clients: (u) => canViewClients(u), // src/app/clients/layout.tsx
  work: (u) => !!u && canUseWork(u.email), // src/app/work/layout.tsx (email allow-list)
  tools: (u) => canUseCertificateTool(u), // src/app/tools/layout.tsx
  onboard: (u) => canOnboard(u), // src/app/onboard/layout.tsx
  agents: (u) => canUseAgents(u), // src/app/agents/layout.tsx; /focus and /workspace too
  coach: (u) => isActive(u), // Daily Coach: every active person (its page keeps its own guard)
  comms: (u) => isActive(u), // Comms drafts: the page keeps its own guard on top
  search: (u) => isActive(u), // Search scopes results to what the person may see
  admin: (u) => isAdmin(u), // src/app/admin/layout.tsx
};

export function canAccessModule(user: SessionUser, key: ModuleKey): boolean {
  return RULES[key](user);
}

// Who may see a coach event. Composes nothing role-based on purpose: coach data is personal.
//
//   the person          every event of theirs
//   their manager       their weekly summary only (User.managerId), never anything else
//   anyone else         nothing: not peers, not partners, not admins
//
// Break nudges and heartbeats are the person's alone (ADR-006); no screen or route shows them to
// anyone else. The rule itself lives in src/lib/rbac/policy.ts (canViewCoachEvent); this module
// keeps its public API and delegates.
import { canViewCoachEvent as viewPolicy } from "@/lib/rbac/policy";

export type CoachViewer = { id: string } | null | undefined;

export function canViewCoachEvent(viewer: CoachViewer, event: { userId: string; kind: string }, owner: { managerId: string | null } | null): boolean {
  return viewPolicy(viewer, event, owner);
}

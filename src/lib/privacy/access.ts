// Who may work the privacy register and the breach register: active admins and partners
// (isManagement). Partners and admins also decide erasure; only a partner lifts a processing
// restriction. The rules live in src/lib/rbac/policy.ts (canHandlePrivacyRequests,
// canDecideErasure, canManageBreaches, canLiftRestriction); this module keeps its public API and
// delegates. The admin pages are additionally behind the admin layout (src/app/admin/layout.tsx),
// so a partner who is not an LMS admin uses the API.
import type { SessionUser } from "@/lib/access";
import { canDecideErasure as decideErasure, canHandlePrivacyRequests, canLiftRestriction as liftRestriction, canManageBreaches } from "@/lib/rbac/policy";

export const canUsePrivacyRegister = (user: SessionUser): boolean => canHandlePrivacyRequests(user);
export const canDecideErasure = (user: SessionUser): boolean => decideErasure(user);
export const canUseBreachRegister = (user: SessionUser): boolean => canManageBreaches(user);
export const canLiftRestriction = (user: SessionUser): boolean => liftRestriction(user);

export const PRIVACY_NOT_ALLOWED = "Only admins and partners can work on privacy requests. Ask one of them to handle this.";
export const BREACH_NOT_ALLOWED = "Only admins and partners can record or update a data breach. Tell one of them straight away.";
export const LIFT_NOT_ALLOWED = "Only a partner can lift a processing restriction. Ask a partner to review this request.";
export const SIGN_IN = "Sign in with an active account to continue.";

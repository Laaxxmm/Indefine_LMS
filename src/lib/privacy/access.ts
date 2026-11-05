// Who may work the privacy register and the breach register: active admins and partners
// (isManagement). Partners and admins also decide erasure. The admin pages are additionally behind
// the admin layout (src/app/admin/layout.tsx), so a partner who is not an LMS admin uses the API.
import { isActive, isManagement, type SessionUser } from "@/lib/access";

export const canUsePrivacyRegister = (user: SessionUser): boolean => isActive(user) && isManagement(user);
export const canDecideErasure = canUsePrivacyRegister;
export const canUseBreachRegister = canUsePrivacyRegister;

export const PRIVACY_NOT_ALLOWED = "Only admins and partners can work on privacy requests. Ask one of them to handle this.";
export const BREACH_NOT_ALLOWED = "Only admins and partners can record or update a data breach. Tell one of them straight away.";
export const SIGN_IN = "Sign in with an active account to continue.";

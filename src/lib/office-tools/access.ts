import type { Session } from "next-auth";
import { isActive } from "@/lib/access";

// Office Tools access rule — any internal-active user, mirroring the original
// standalone dashboard where every employee could use the document/tax utilities.
// Same internal-active gate as the certificate tool; kept as its own function so it
// can be tightened independently later. The /tools layout already enforces this too.
export function canUseOfficeTools(user: Session["user"] | undefined | null): boolean {
  return isActive(user);
}

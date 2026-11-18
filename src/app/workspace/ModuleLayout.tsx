// Layouts that only apply a workspace switch, for page folders without a layout of their own.
//
//   moduleLayout(key)  /leaderboard, /team, /initiatives, /checkin, /recap, /video, /quiz: signed in,
//                      and the module is on for the person. Each page keeps its own guard.
//   firmOsLayout()     the admin Firm OS pages (all but Workspace settings): closed while the
//                      Firm OS master switch FIRM_OS_ENABLED is off. The admin layout checks admin first.
//
//   // src/app/leaderboard/layout.tsx
//   export const dynamic = "force-dynamic";
//   export default moduleLayout("leaderboard");
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireFirmOs, requireModule } from "@/lib/workspace/guard";
import type { ModuleKey } from "@/lib/workspace/registry";

export function moduleLayout(key: ModuleKey) {
  return async function ModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect("/");
    await requireModule(session.user, key);
    return <>{children}</>;
  };
}

export function firmOsLayout() {
  return async function FirmOsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect("/");
    requireFirmOs(session.user);
    return <>{children}</>;
  };
}

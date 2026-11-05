import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ActivityPing } from "@/components/ActivityPing";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { isBreakNudgeEnabled } from "@/lib/agents/coach/flags";
import { canOnboard } from "@/lib/rbac/policy";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Firm OS plain-English onboarding. Partners, managers and admins only (src/lib/rbac/policy.ts).
export default async function OnboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canOnboard(session.user)) redirect("/dashboard");
  await requireModule(session.user, "onboard");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/onboard" width="max-w-[1180px]" />
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
      <ActivityPing enabled={isBreakNudgeEnabled()} />
    </div>
  );
}

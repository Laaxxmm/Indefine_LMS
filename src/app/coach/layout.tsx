import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ActivityPing } from "@/components/ActivityPing";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { pageMain } from "@/components/ui";
import { canUseAgents } from "@/lib/agents/access";
import { isBreakNudgeEnabled } from "@/lib/agents/coach/flags";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Firm OS daily coach: the person's own board, reminders, weekly summary and break settings.
// Every active person may open it (while the Daily Coach module is on for them); it only ever shows
// their own data (and, for a manager, their reports' weekly summaries).
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "coach");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/coach" />
      <main className={pageMain}>{children}</main>
      <ActivityPing enabled={isBreakNudgeEnabled()} />
    </div>
  );
}

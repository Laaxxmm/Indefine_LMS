import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ActivityPing } from "@/components/ActivityPing";
import { FirmOsHeader, firmOsLink } from "@/components/FirmOsHeader";
import { NavLink } from "@/components/NavLink";
import { canSeeMistakeLog, canSeeAllRuns, canUseAgents } from "@/lib/agents/access";
import { isBreakNudgeEnabled } from "@/lib/agents/coach/flags";
import { visibleAgents } from "@/lib/agents/registry";
import { requireModule } from "@/lib/workspace/guard";
import { runsListLabel } from "./parts";

export const dynamic = "force-dynamic";

// Firm OS agents: draft packs prepared by task agents, reviewed and approved by people.
// Nothing on these pages files with a portal or sends anything to a client.
// The Firm OS header on top; this section's own pages (the runs list, each agent, the mistake log)
// in a second row below it.
export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "agents");
  const agents = visibleAgents();

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/agents" />
      <div className="border-b border-border bg-card/60">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-2">
          <nav aria-label="Agents" className="flex items-center gap-1 max-w-full overflow-x-auto">
            <NavLink href="/agents" exact className={firmOsLink}>
              {runsListLabel(canSeeAllRuns(session.user))}
            </NavLink>
            {agents.map((a) => (
              <NavLink key={a.key} href={`/agents/${a.key}`} className={firmOsLink}>
                {a.title}
              </NavLink>
            ))}
            {canSeeMistakeLog(session.user) && (
              <NavLink href="/agents/mistakes" className={firmOsLink}>
                Mistake log
              </NavLink>
            )}
          </nav>
        </div>
      </div>
      <main className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8">{children}</main>
      <ActivityPing enabled={isBreakNudgeEnabled()} />
    </div>
  );
}

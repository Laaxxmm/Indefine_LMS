import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { pageMain } from "@/components/ui";
import { canUseAgents } from "@/lib/agents/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Guided workspace: one job with its SOP steps beside its documents. Same access as /agents, and
// only while the Agents module is on. The Firm OS header marks Next task, which it belongs to.
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "agents");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/focus" />
      <main className={pageMain}>{children}</main>
    </div>
  );
}

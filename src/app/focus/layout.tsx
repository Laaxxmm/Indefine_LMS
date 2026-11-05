import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { canUseAgents } from "@/lib/agents/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Focus mode: one task at a time. The same calm Firm OS header as every Firm OS page (Next task is
// the current section), then one narrow column with generous whitespace so nothing competes with
// the task. Same access as /agents, and only while the Agents module is on.
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "agents");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/focus" />
      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

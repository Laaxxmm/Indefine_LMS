import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { pageMain, readingWidth } from "@/components/ui";
import { canUseAgents } from "@/lib/agents/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Focus mode: one task at a time. The same Firm OS header as every Firm OS page, at the same width
// and position (Next task is the current section); the content keeps a narrower reading column,
// left-aligned in the same page box so the title starts where every other page's title starts.
// Same access as /agents, and only while the Agents module is on.
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "agents");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/focus" />
      <main className={pageMain}>
        <div className={readingWidth}>{children}</div>
      </main>
    </div>
  );
}

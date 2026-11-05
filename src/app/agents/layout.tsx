import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canDecideMistakes, canSeeAllRuns, canUseAgents } from "@/lib/agents/access";
import { visibleAgents } from "@/lib/agents/registry";
import { focusRing } from "./parts";

export const dynamic = "force-dynamic";

const link = `px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

// Firm OS agents: draft packs prepared by task agents, reviewed and approved by people.
// Nothing on these pages files with a portal or sends anything to a client.
export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  const agents = visibleAgents();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/agents" className={`flex items-center gap-2.5 rounded-lg ${focusRing}`}>
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-mute uppercase tracking-[0.16em] font-extrabold">Agents</p>
            </div>
          </Link>
          <nav aria-label="Agents" className="flex items-center gap-1 flex-wrap">
            <Link href="/agents" className={link}>
              {canSeeAllRuns(session.user) ? "All runs" : "My runs"}
            </Link>
            {agents.map((a) => (
              <Link key={a.key} href={`/agents/${a.key}`} className={link}>
                {a.title}
              </Link>
            ))}
            {(canDecideMistakes(session.user) || canSeeAllRuns(session.user)) && (
              <Link href="/agents/mistakes" className={link}>
                Mistake log
              </Link>
            )}
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActivityPing } from "@/components/ActivityPing";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { canUseAgents } from "@/lib/agents/access";
import { isBreakNudgeEnabled } from "@/lib/agents/coach/flags";
import { focusRing } from "@/app/agents/parts";

export const dynamic = "force-dynamic";

const link = `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

// Firm OS daily coach: the person's own board, reminders, weekly summary and break settings.
// Every active person may open it; it only ever shows their own data (and, for a manager, their
// reports' weekly summaries). The header grows instead of clipping, as on /agents.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-3 min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link href="/coach" className={`flex items-center gap-2.5 rounded-lg shrink-0 ${focusRing}`}>
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-mute uppercase tracking-[0.16em] font-extrabold">Firm OS</p>
            </div>
          </Link>
          <nav aria-label="Firm OS" className="flex items-center gap-1 max-w-full overflow-x-auto">
            <NavLink href="/coach" className={link}>
              My day
            </NavLink>
            <Link href="/agents" className={link}>
              Agents
            </Link>
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8">{children}</main>
      <ActivityPing enabled={isBreakNudgeEnabled()} />
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { canUseAgents } from "@/lib/agents/access";
import { focusRing } from "@/app/agents/parts";

export const dynamic = "force-dynamic";

const link = `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

// Firm OS Companion pairing. Any signed-in person reaches the layout; the page itself decides
// whether they may pair (src/lib/companion/access.ts) and says so plainly when they may not.
// The header grows instead of clipping: on a phone the nav takes its own row and scrolls sideways.
export default async function CompanionLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 py-3 min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link href="/companion" className={`flex items-center gap-2.5 rounded-lg shrink-0 ${focusRing}`}>
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-mute uppercase tracking-[0.16em] font-extrabold">Firm OS</p>
            </div>
          </Link>
          <nav aria-label="Firm OS" className="flex items-center gap-1 max-w-full overflow-x-auto">
            <NavLink href="/companion" className={link}>
              Companion
            </NavLink>
            {canUseAgents(session.user) && (
              <Link href="/agents" className={link}>
                Agents
              </Link>
            )}
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

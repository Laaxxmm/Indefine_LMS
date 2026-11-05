import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canUseAgents } from "@/lib/agents/access";
import { requireModule } from "@/lib/workspace/guard";
import { focusRing } from "@/app/agents/parts";

export const dynamic = "force-dynamic";

const link = `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

// Focus mode: one task at a time. The header carries only the logo and one way back; nothing else
// competes with the task. One narrow column (calm, generous whitespace); the header matches its
// width so the edges line up. Same access as /agents, and only while the Agents module is on.
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "agents");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-3 min-h-16 flex items-center justify-between gap-4">
          <Link href="/focus" className={`flex items-center gap-2.5 rounded-lg shrink-0 ${focusRing}`}>
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-mute uppercase tracking-[0.16em] font-extrabold">Focus</p>
            </div>
          </Link>
          <Link href="/dashboard" className={`${link} flex items-center gap-2`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { LogoMark } from "@/components/Logo";
import { actorFrom } from "@/lib/work/actor";

export const dynamic = "force-dynamic";

const link = "px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition";

// Signed-out users go to sign-in. Signed-in users who are not on WORK_TRACKER_EMAILS get a
// 404 so the module stays invisible to the rest of the firm.
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!actorFrom(session)) notFound();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/work" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Tech work</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/work" className={link}>Today</Link>
            <Link href="/work/board" className={link}>Board</Link>
            <Link href="/work/week" className={link}>Week</Link>
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

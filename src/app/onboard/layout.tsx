import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canOnboard } from "@/lib/rbac/policy";

export const dynamic = "force-dynamic";

const link = "px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

// Firm OS plain-English onboarding. Partners, managers and admins only (src/lib/rbac/policy.ts).
export default async function OnboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canOnboard(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/onboard" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Firm OS</p>
            </div>
          </Link>
          <nav aria-label="Firm OS" className="flex items-center gap-1">
            <Link href="/onboard" className={link}>Firm OS onboarding</Link>
            <Link href="/clients" className={link}>Clients</Link>
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}><ArrowLeft className="w-4 h-4" aria-hidden /> Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

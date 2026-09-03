import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canViewClients, isClientsAdmin } from "@/lib/clients/core";

export const dynamic = "force-dynamic";

const link = "px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition";

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewClients(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/clients" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Clients</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/clients" className={link}>All clients</Link>
            <Link href="/clients/new" className={link}>Onboard</Link>
            <Link href="/clients/reports" className={link}>Reports</Link>
            {isClientsAdmin(session.user) && <Link href="/clients/admin/services" className={link}>Services</Link>}
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

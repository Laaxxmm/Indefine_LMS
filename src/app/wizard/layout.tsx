import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { LogoMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function WizardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="min-h-screen relative">
      {/* Background blobs */}
      <div className="fixed top-0 -left-40 w-[36rem] h-[36rem] bg-brand-200/40 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-0 -right-40 w-[36rem] h-[36rem] bg-violet-200/40 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Top bar */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-border bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <LogoMark size={36} />
          <div>
            <p className="font-display text-[15px] font-extrabold leading-tight tracking-[-0.02em]">
              indefine
            </p>
            <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold leading-none mt-0.5">
              Growth Wizard
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-ink-mute hover:text-ink hover:bg-muted transition"
        >
          <X className="w-4 h-4" />
          Save & exit
        </Link>
      </header>

      <main className="px-6 py-10 max-w-3xl mx-auto">{children}</main>
    </div>
  );
}

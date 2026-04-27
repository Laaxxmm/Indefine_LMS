import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, X } from "lucide-react";

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
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-faint font-bold leading-none">
              Indefine LMS
            </p>
            <p className="text-sm font-bold leading-tight mt-0.5">Growth Wizard</p>
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

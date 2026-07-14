import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canUseCertificateTool } from "@/lib/certificates/access";

export const dynamic = "force-dynamic";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  // Internal-active users only (§2). No `!!user` fallback.
  if (!canUseCertificateTool(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/tools" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Tools</p>
            </div>
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

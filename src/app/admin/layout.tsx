import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import AdminNav from "./AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-border bg-card flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <LogoMark size={36} />
            <div>
              <p className="font-display text-[15px] font-extrabold leading-tight tracking-[-0.02em]">
                indefine
              </p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">
                Admin
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <AdminNav
            items={[
              { href: "/admin", label: "Overview", icon: "LayoutDashboard" },
              { href: "/admin?tab=videos", label: "Videos & Quizzes", icon: "PlayCircle" },
              { href: "/admin/live", label: "Live sessions", icon: "Radio" },
              { href: "/admin/auto-quiz", label: "Auto-quiz (AI)", icon: "Sparkles" },
              { href: "/admin/assignments", label: "Assignments", icon: "Target" },
              { href: "/admin/courses", label: "Courses & Deadlines", icon: "CalendarClock" },
              { href: "/admin/team", label: "Team & hierarchy", icon: "Users" },
              { href: "/admin/branches", label: "Branches", icon: "Building2" },
              { href: "/admin/trajectory", label: "Trajectory", icon: "Sparkles" },
              { href: "/admin/approvals", label: "Approvals", icon: "CheckCircle2" },
              { href: "/admin/checkins", label: "Check-ins", icon: "MessageCircle" },
              { href: "/admin/attendance", label: "Attendance", icon: "Fingerprint" },
              { href: "/admin/kra", label: "KRA Reports", icon: "BarChart3" },
              { href: "/admin/settings", label: "Settings", icon: "Settings" },
            ]}
          />
        </nav>

        <div className="px-3 py-3 border-t border-border">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-ink-mute hover:bg-muted transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <div className="lg:hidden border-b border-border bg-white px-4 py-3 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm text-ink-mute">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
          <span className="font-display font-bold">Admin</span>
        </div>

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}


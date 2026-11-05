import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Menu } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import AdminNav, { type AdminNavItem } from "./AdminNav";
import { isAdmin } from "@/lib/access";
import { requireModule } from "@/lib/workspace/guard";
import { firmOsEnabled } from "@/lib/workspace/flag";

export const dynamic = "force-dynamic";

const LMS_ITEMS: AdminNavItem[] = [
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
];
// Firm OS admin pages, grouped under their own heading; labels are the pages' titles.
const FIRM_OS_ITEMS: AdminNavItem[] = [
  { href: "/admin/firm-os/models", label: "Model usage", icon: "Cpu" },
  { href: "/admin/firm-os/mistakes", label: "Mistake log", icon: "BookCheck" },
  { href: "/admin/firm-os/cycle-time", label: "Cycle time", icon: "Timer" },
  { href: "/admin/firm-os/workspace", label: "Workspace settings", icon: "Settings" },
  { href: "/admin/firm-os/privacy", label: "Privacy requests", icon: "Fingerprint" },
  { href: "/admin/firm-os/breaches", label: "Breach register", icon: "CalendarClock" },
];
const SETTINGS_ITEMS: AdminNavItem[] = [{ href: "/admin/settings", label: "Settings", icon: "Settings" }];
const WORKSPACE_SETTINGS = "/admin/firm-os/workspace";

/** While FIRM_OS_ENABLED is off only Workspace settings stays, so the rollout can be prepared. */
const firmOsItems = () => (firmOsEnabled() ? FIRM_OS_ITEMS : FIRM_OS_ITEMS.filter((i) => i.href === WORKSPACE_SETTINGS));

const groupLabel = "px-3 pt-4 pb-1 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase";

/** The admin menu, for the sidebar (large screens) and the "Admin menu" disclosure (phones and tablets). */
function AdminMenu() {
  return (
    <>
      <AdminNav items={LMS_ITEMS} />
      <p className={groupLabel}>Firm OS</p>
      <AdminNav items={firmOsItems()} />
      <div className="pt-3">
        <AdminNav items={SETTINGS_ITEMS} />
      </div>
    </>
  );
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
  await requireModule(session.user, "admin"); // an admin always keeps it, so this never reads or redirects

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

        <div className="px-3 pt-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-brand-50 text-brand-700 hover:bg-brand-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            My Dashboard
          </Link>
        </div>

        <nav aria-label="Admin" className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <AdminMenu />
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
        {/* Mobile header: the sidebar is hidden below lg, so its menu opens from here. */}
        <div className="lg:hidden border-b border-border bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 text-sm text-ink-mute">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Link>
            <span className="font-display font-bold">Admin</span>
          </div>
          <details className="mt-2 group">
            <summary className="list-none cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-ink-soft hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
              <Menu className="w-4 h-4" aria-hidden="true" />
              Admin menu
            </summary>
            <nav aria-label="Admin" className="mt-2 space-y-0.5">
              <AdminMenu />
            </nav>
          </details>
        </div>

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}


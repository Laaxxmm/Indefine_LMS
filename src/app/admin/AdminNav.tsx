"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  PlayCircle,
  Target,
  CalendarClock,
  BarChart3,
  Sparkles,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  PlayCircle,
  Target,
  CalendarClock,
  BarChart3,
  Sparkles,
  CheckCircle2,
};

export default function AdminNav({
  items,
}: {
  items: { href: string; label: string; icon: string }[];
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = search.get("tab");

  return (
    <>
      {items.map((it) => {
        const url = new URL(it.href, "http://x");
        const targetPath = url.pathname;
        const targetTab = url.searchParams.get("tab");
        const active =
          pathname === targetPath &&
          (targetTab ? targetTab === tab : !tab || pathname !== "/admin");

        // Special-case Overview: matches /admin with no tab.
        const isOverview = it.href === "/admin";
        const isActive = isOverview
          ? pathname === "/admin" && !tab
          : active;

        const Icon = ICONS[it.icon] ?? LayoutDashboard;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
              isActive
                ? "bg-brand-50 text-brand-700 font-semibold"
                : "text-ink-soft hover:bg-muted"
            }`}
          >
            <Icon className="w-4 h-4" />
            {it.label}
          </Link>
        );
      })}
    </>
  );
}

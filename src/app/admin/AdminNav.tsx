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
  MessageCircle,
  Users,
  Building2,
  Fingerprint,
  Settings,
  Radio,
  Cpu,
  BookCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Cpu,
  LayoutDashboard,
  PlayCircle,
  Target,
  CalendarClock,
  BarChart3,
  Sparkles,
  CheckCircle2,
  MessageCircle,
  Users,
  Building2,
  Fingerprint,
  Settings,
  Radio,
  BookCheck,
  Timer,
};

export type AdminNavItem = { href: string; label: string; icon: string };

/**
 * Is `it` the current page? Overview is /admin with no tab; a ?tab= item matches that tab on
 * /admin; any other item matches its own path and the pages below it (/admin/kra/[userId]
 * keeps "KRA Reports" lit).
 */
export function isAdminNavActive(href: string, pathname: string, tab: string | null): boolean {
  const url = new URL(href, "http://x");
  const targetTab = url.searchParams.get("tab");
  if (href === "/admin") return pathname === "/admin" && !tab;
  if (targetTab) return pathname === url.pathname && targetTab === tab;
  return pathname === url.pathname || pathname.startsWith(`${url.pathname}/`);
}

export default function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const tab = search.get("tab");

  return (
    <>
      {items.map((it) => {
        const isActive = isAdminNavActive(it.href, pathname, tab);
        const Icon = ICONS[it.icon] ?? LayoutDashboard;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              isActive
                ? "bg-brand-50 text-brand-600 font-bold"
                : "text-ink-soft hover:bg-muted"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {it.label}
          </Link>
        );
      })}
    </>
  );
}

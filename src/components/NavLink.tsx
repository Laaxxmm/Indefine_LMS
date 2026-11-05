"use client";

// Header nav link that marks the section the person is in: aria-current="page" plus the active
// style the dashboard and admin sidebar use (brand-50 fill, brand-600 text). `exact` for a section
// root whose children have nav links of their own (e.g. /agents vs /agents/echo).
import Link from "next/link";
import { usePathname } from "next/navigation";

export const navActive = "bg-brand-50 text-brand-600 hover:bg-brand-50 hover:text-brand-600";

export function isCurrentSection(pathname: string | null | undefined, href: string, exact = false): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "") || "/";
  return exact ? p === href : p === href || p.startsWith(href.endsWith("/") ? href : `${href}/`);
}

export function NavLink({ href, className, exact = false, children }: { href: string; className: string; exact?: boolean; children: React.ReactNode }) {
  const active = isCurrentSection(usePathname(), href, exact);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={active ? `${className} ${navActive}` : className}>
      {children}
    </Link>
  );
}

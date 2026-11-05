"use client";

// Header nav link that marks the section the person is in: aria-current="page" plus the active
// style the dashboard and admin sidebar use (brand-50 fill, brand-600 text). `exact` for a section
// root whose children have nav links of their own (e.g. /agents vs /agents/echo); `also` for other
// paths that belong to the section (the guided workspace under Next task); `except` for paths under
// it that are another link's section (Spot checks under Agents).
import Link from "next/link";
import { usePathname } from "next/navigation";

export const navActive = "bg-brand-50 text-brand-600 hover:bg-brand-50 hover:text-brand-600";

type SectionOpts = { also?: readonly string[]; except?: readonly string[] };

const under = (p: string, href: string) => p === href || p.startsWith(href.endsWith("/") ? href : `${href}/`);

export function isCurrentSection(pathname: string | null | undefined, href: string, exact = false, opts: SectionOpts = {}): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "") || "/";
  if (opts.except?.some((x) => under(p, x))) return false;
  if (opts.also?.some((x) => under(p, x))) return true;
  return exact ? p === href : under(p, href);
}

export function NavLink({
  href,
  className,
  exact = false,
  also,
  except,
  children,
}: {
  href: string;
  className: string;
  exact?: boolean;
  also?: readonly string[];
  except?: readonly string[];
  children: React.ReactNode;
}) {
  const active = isCurrentSection(usePathname(), href, exact, { also, except });
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={active ? `${className} ${navActive}` : className}>
      {children}
    </Link>
  );
}

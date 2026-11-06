// The header of an LMS area (Clients, Tech work, Tools): the logo with the area's name, the area's
// own pages with the current one marked (NavLink: brand-50 fill, aria-current), Help for the page
// (when the help registry has an entry for it: src/lib/help/pages.ts) and the way back to the
// dashboard. Same pills as the Firm OS header (navPill in ui.ts); it grows instead of clipping, so
// on a phone the nav takes its own row.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { focusRing, navIcon, navPill, pageGutter } from "@/components/ui";

/** A nav pill (navPill in ui.ts), kept under this name for the areas' pages. */
export const areaLink = navPill;

export type AreaNavItem = { href: string; label: string; exact?: boolean; except?: readonly string[] };

export function AreaHeader({ home, area, links, width = "max-w-[1180px]" }: { home: string; area: string; links: AreaNavItem[]; width?: string }) {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
      <div className={`${width} mx-auto ${pageGutter} py-3 min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
        <Link href={home} className={`flex items-center gap-3 rounded-lg shrink-0 ${focusRing}`}>
          <LogoMark size={34} />
          <div className="leading-tight">
            <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
            <p className="text-[11px] leading-4 text-ink-mute uppercase tracking-[0.16em] font-extrabold">{area}</p>
          </div>
        </Link>
        <nav aria-label={area} className="flex flex-wrap items-center gap-1 max-w-full">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} exact={l.exact} except={l.except} className={areaLink}>
              {l.label}
            </NavLink>
          ))}
          <HelpButton className={navIcon} labelClassName="sr-only sm:not-sr-only" />
          <Link href="/dashboard" className={`${areaLink} flex items-center gap-2`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}

// The header of an LMS area (Clients, Tech work, Tools): the logo with the area's name, the area's
// own pages with the current one marked (NavLink: brand-50 fill, aria-current), and the way back to
// the dashboard. Same build as the Firm OS header (src/components/FirmOsHeader.tsx): it grows
// instead of clipping, so on a phone the nav takes its own row and scrolls sideways.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { focusRing, pageGutter } from "@/components/ui";

/** A nav pill: the Firm OS header's link (14 px semibold, 36 px tall, focus ring). */
export const areaLink = `shrink-0 whitespace-nowrap px-4 py-2 leading-5 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

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
        <nav aria-label={area} className="flex items-center gap-1 max-w-full overflow-x-auto">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} exact={l.exact} except={l.except} className={areaLink}>
              {l.label}
            </NavLink>
          ))}
          <Link href="/dashboard" className={`${areaLink} flex items-center gap-2`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}

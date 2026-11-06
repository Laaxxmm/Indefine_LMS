// The one Firm OS header, shared by every Firm OS page (agents, onboarding, my day, client
// messages, search, focus, the guided workspace, companion). Same width (contentWidth, 1280),
// position and labels on every page: a page may narrow its own content, never the header.
//
//   lg and up   logo · Next task · Agents · My day · Client messages · More ▾ · Search · Help · Dashboard
//   below lg    logo · Search · Help · Menu ▾ (the same places, in the same order, then Dashboard)
//
// Each place only when its module is on and the role may use it (src/lib/workspace/nav.ts), with
// the current section marked. A page's own sub-pages go in a second row below it (FirmOsSubnav:
// the agents and the mistake log on agent pages).
import Link from "next/link";
import { ArrowLeft, Menu } from "lucide-react";
import type { SessionUser } from "@/lib/access";
import { HelpButton } from "@/components/HelpButton";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { NavMenu, type MenuSection } from "@/components/NavMenu";
import { SearchButton } from "@/components/SearchButton";
import { companionVisibleFor } from "@/lib/workspace/guard";
import { firmOsNav } from "@/lib/workspace/nav";
import { contentWidth, focusRing, navIcon, navPill, pageGutter } from "@/components/ui";
import { effectiveModules } from "@/lib/workspace/settings";

/** A nav pill (navPill in ui.ts): kept under this name for the agents' second row. */
export const firmOsLink = navPill;

/** The header's row: the same box on every Firm OS page, so the logo and the page title line up. */
export const firmOsRow = `${contentWidth} mx-auto ${pageGutter}`;

/** `home`: where the logo goes (the section's own start page). */
export async function FirmOsHeader({ user, home }: { user: SessionUser; home: string }) {
  const [modules, companion] = await Promise.all([effectiveModules(user), companionVisibleFor(user)]);
  const nav = firmOsNav(user, modules, { companion });
  const dashboard = { href: "/dashboard", label: "Dashboard" };
  const phone: MenuSection[] = [{ items: nav.primary }, { items: nav.more }, { items: [dashboard] }].filter((s) => s.items.length > 0);
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
      <div className={`${firmOsRow} py-3 min-h-16 flex items-center justify-between gap-4`}>
        <Link href={home} className={`flex items-center gap-3 rounded-lg shrink-0 ${focusRing}`}>
          <LogoMark size={34} />
          <div className="leading-tight">
            <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
            {/* ink-mute, not ink-faint: ink-faint on white is ~2:1, below AA. */}
            <p className="text-[11px] leading-4 text-ink-mute uppercase tracking-[0.16em] font-extrabold">Firm OS</p>
          </div>
        </Link>
        <nav aria-label="Firm OS" className="flex items-center gap-1">
          {nav.primary.map((l) => (
            <NavLink key={l.href} href={l.href} exact={l.exact} also={l.also} except={l.except} className={`${navPill} hidden lg:inline-flex`}>
              {l.label}
            </NavLink>
          ))}
          {nav.more.length > 0 && <NavMenu label="More" sections={[{ items: nav.more }]} buttonClassName={navPill} className="hidden lg:block" />}
          {nav.search && <SearchButton className={navIcon} />}
          <HelpButton className={navIcon} labelClassName="sr-only lg:not-sr-only" />
          <Link href={dashboard.href} className={`${navPill} hidden lg:inline-flex items-center gap-2`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {dashboard.label}
          </Link>
          <NavMenu label="Menu" sections={phone} buttonClassName={navPill} className="lg:hidden" icon={<Menu className="w-4 h-4" aria-hidden="true" />} />
        </nav>
      </div>
    </header>
  );
}

/** A section's own pages, in a second row under the header (same width and left edge). */
export function FirmOsSubnav({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-card/60">
      <div className={`${firmOsRow} py-2`}>
        <nav aria-label={label} className="flex items-center gap-1 max-w-full overflow-x-auto">
          {children}
        </nav>
      </div>
    </div>
  );
}

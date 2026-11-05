// The one Firm OS header, shared by every Firm OS page (agents, onboarding, my day, client
// messages, search, focus, the guided workspace, companion). The same short set of places for
// everyone, each only when its module is on and the role may use it (src/lib/workspace/nav.ts),
// with the current section marked; then Search (the command palette) and the way back to the
// dashboard. A page's own sub-pages go in a second row below it (the agents list does this).
// The header grows instead of clipping: on a phone the nav takes its own row and scrolls sideways.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SessionUser } from "@/lib/access";
import { canSeeAllRuns } from "@/lib/agents/access";
import { runsListLabel } from "@/app/agents/parts";
import { LogoMark } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { SearchButton } from "@/components/SearchButton";
import { companionVisibleFor } from "@/lib/workspace/guard";
import { firmOsNav } from "@/lib/workspace/nav";
import { contentWidth, focusRing, pageGutter } from "@/components/ui";
import { effectiveModules } from "@/lib/workspace/settings";

/** A nav pill: 14 px semibold, 36 px tall (20 line + 2 × 8), the shared focus ring. */
export const firmOsLink = `shrink-0 whitespace-nowrap px-4 py-2 leading-5 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;

/**
 * `home`: where the logo goes (the section's own start page). `width`: the page's content width, so
 * the logo and the nav line up with the content edges.
 */
export async function FirmOsHeader({ user, home, width = contentWidth }: { user: SessionUser; home: string; width?: string }) {
  const [modules, companion] = await Promise.all([effectiveModules(user), companionVisibleFor(user)]);
  const nav = firmOsNav(user, modules, { companion, agentsLabel: runsListLabel(canSeeAllRuns(user)) });
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
      <div className={`${width} mx-auto ${pageGutter} py-3 min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
        <Link href={home} className={`flex items-center gap-3 rounded-lg shrink-0 ${focusRing}`}>
          <LogoMark size={34} />
          <div className="leading-tight">
            <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
            {/* ink-mute, not ink-faint: ink-faint on white is ~2:1, below AA. */}
            <p className="text-[11px] leading-4 text-ink-mute uppercase tracking-[0.16em] font-extrabold">Firm OS</p>
          </div>
        </Link>
        <nav aria-label="Firm OS" className="flex items-center gap-1 max-w-full overflow-x-auto">
          {nav.links.map((l) => (
            <NavLink key={l.href} href={l.href} exact={l.exact} also={l.also} except={l.except} className={firmOsLink}>
              {l.label}
            </NavLink>
          ))}
          {nav.search && <SearchButton className={firmOsLink} />}
          <Link href="/dashboard" className={`${firmOsLink} flex items-center gap-2`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}

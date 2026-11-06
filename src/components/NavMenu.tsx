"use client";

// A header menu: a button that opens a short list of links below it (the Firm OS header's "More",
// the dashboard's "Learn" and "Firm OS", and the phone "Menu" of both). Disclosure navigation, not
// an application menu: the entries are ordinary links (NavLink marks the current one), so Tab moves
// through them as through any links.
//
// Keyboard: Enter / Space / ArrowDown on the button opens it and ArrowDown moves to the first link;
// ArrowUp / ArrowDown move between links, Home / End to the first / last; Escape closes and returns
// focus to the button. It closes when focus leaves it, on a click outside, and when the route
// changes. The panel is in the page while closed (hidden), so the links render on the server too.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { NavLink, isCurrentSection, navActive } from "@/components/NavLink";
import { cx, menuHeading, menuItem, menuPanel } from "@/components/ui";
import { moveActive } from "@/lib/search/keyboard";
import type { NavItem } from "@/lib/workspace/nav";

export type MenuSection = { heading?: string; items: readonly NavItem[] };

export function NavMenu({
  label,
  sections,
  buttonClassName,
  className = "",
  align = "right",
  icon,
  tour,
}: {
  /** The button's text ("More", "Learn", "Menu"); the panel is named after it. */
  label: string;
  sections: readonly MenuSection[];
  buttonClassName: string;
  /** Classes for the wrapper (e.g. `lg:hidden` for the phone menu). */
  className?: string;
  /** Which edge of the button the panel lines up with. */
  align?: "left" | "right";
  /** An icon before the label (the phone menu's bars). */
  icon?: React.ReactNode;
  /** The onboarding tour's anchor, when one of the links had it. */
  tour?: string;
}) {
  const id = useId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const items = sections.flatMap((s) => s.items);
  const current = items.some((i) => isCurrentSection(pathname, i.href, i.exact, { also: i.also, except: i.except }));

  const links = () => Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // A new page closes it (a link inside was followed, or the person went back).
  useEffect(() => setOpen(false), [pathname]);

  useLayoutEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    links()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const list = links();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.target === button.current) {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      if (open) list[0].focus();
      else {
        focusFirst.current = true; // once the panel shows (the layout effect below)
        setOpen(true);
      }
      return;
    }
    if (at < 0) return;
    const next = moveActive(e.key, at, list.length, { wrap: true });
    if (next === null || next < 0) return;
    e.preventDefault();
    list[next].focus();
  }

  return (
    <div
      ref={wrap}
      className={cx("relative", className)}
      onKeyDown={onKey}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-tour={tour}
        onClick={() => setOpen((o) => !o)}
        className={cx(buttonClassName, "inline-flex items-center gap-2", current && navActive)}
      >
        {icon}
        {label}
        <ChevronDown className={cx("w-4 h-4 transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      {/* A link to the page already open (a #section of it) changes no route: a click on a link closes it here too. */}
      <div
        ref={panel}
        id={id}
        hidden={!open}
        onClick={(e) => {
          if ((e.target as Element).closest("a")) setOpen(false);
        }}
        className={cx(menuPanel, align === "right" ? "right-0" : "left-0")}
      >
        {sections.map((s, i) => (
          <div key={s.heading ?? i} className={cx(i > 0 && "mt-1 pt-1 border-t border-border")}>
            {s.heading && <p className={menuHeading}>{s.heading}</p>}
            <ul aria-label={s.heading}>
              {s.items.map((item) => (
                <li key={item.href}>
                  <NavLink href={item.href} exact={item.exact} also={item.also} except={item.except} className={menuItem}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

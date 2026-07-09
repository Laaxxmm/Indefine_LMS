"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck, Users, Rocket, ChevronDown } from "lucide-react";

export function UserMenu({
  name,
  initial,
  isAdmin,
  reportCount,
  signOutAction,
}: {
  name: string;
  initial: string;
  isAdmin: boolean;
  reportCount: number;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex items-center gap-1.5"
      >
        <span
          className="w-10 h-10 rounded-full grid place-items-center text-white font-extrabold text-base"
          style={{
            background: "linear-gradient(135deg,#6D5BF0,#4B37D8)",
            boxShadow: "0 4px 12px -3px rgba(91,75,230,0.5)",
          }}
        >
          {initial}
        </span>
        <ChevronDown className={`w-4 h-4 text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-2xl shadow-lift p-2 z-50 animate-fade-in">
          <div className="px-3 py-2">
            <p className="text-sm font-bold text-ink truncate">{name}</p>
            <p className="text-xs text-ink-faint">{isAdmin ? "Administrator" : "Employee"}</p>
          </div>
          <div className="h-px bg-border my-1" />
          {reportCount > 0 && (
            <MenuLink href="/team" icon={Users}>
              My team ({reportCount})
            </MenuLink>
          )}
          {isAdmin && (
            <MenuLink href="/admin" icon={ShieldCheck}>
              Admin console
            </MenuLink>
          )}
          <MenuLink href="/initiatives" icon={Rocket}>
            Initiatives
          </MenuLink>
          <div className="h-px bg-border my-1" />
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-ink-soft hover:bg-muted transition"
            >
              <LogOut className="w-4 h-4 text-ink-mute" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-ink-soft hover:bg-muted transition"
    >
      <Icon className="w-4 h-4 text-ink-mute" />
      {children}
    </Link>
  );
}

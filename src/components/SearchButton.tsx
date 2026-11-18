"use client";

// Search icon button for a header: opens the command palette (mounted once in src/app/layout.tsx,
// only for people with the Search module on). Ctrl+K, or Cmd+K on a Mac, opens it too; the hint
// beside the icon says so from a tablet up (on a phone there is no keyboard to press it on).
import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/CommandPalette";
import { cx, kbdHint } from "@/components/ui";

export function SearchButton({ className }: { className: string }) {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      aria-label="Search"
      aria-keyshortcuts="Control+K Meta+K"
      title="Search (Ctrl+K, or Cmd+K on a Mac)"
      className={cx(className, "inline-flex items-center gap-2")}
    >
      <Search className="w-4 h-4" aria-hidden="true" />
      <kbd aria-hidden="true" className={cx(kbdHint, "hidden md:inline")}>
        Ctrl K
      </kbd>
    </button>
  );
}

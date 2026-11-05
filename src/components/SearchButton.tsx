"use client";

// "Search" button for a header: opens the command palette (mounted once in src/app/layout.tsx,
// only for people with the Search module on). Ctrl+K, or Cmd+K on a Mac, opens it too.
import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/CommandPalette";

export function SearchButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={() => openCommandPalette()} aria-keyshortcuts="Control+K Meta+K" title="Search (Ctrl+K)" className={`${className} inline-flex items-center gap-2`}>
      <Search className="w-4 h-4" aria-hidden="true" />
      Search
    </button>
  );
}

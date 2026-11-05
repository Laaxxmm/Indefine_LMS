// Keyboard behaviour shared by the /search page and the command palette. Pure and client-safe, so
// the rules are unit-tested without a browser.

type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

/** Ctrl+K (Windows, Linux) or ⌘+K (macOS) opens the command palette. */
export function isPaletteShortcut(e: KeyLike): boolean {
  return !!(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/**
 * The next active result for a key, or null when the key is not a move. -1 is "the search box".
 *
 * - page (wrap: false): Down from the box goes to the first result, Up from the first result goes
 *   back to the box; Home / End jump to the first / last result.
 * - palette (wrap: true): Down and Up cycle through the results; the box keeps focus throughout.
 */
export function moveActive(key: string, current: number, count: number, opts: { wrap: boolean }): number | null {
  if (count <= 0) return key === "ArrowUp" || key === "ArrowDown" ? -1 : null;
  switch (key) {
    case "ArrowDown":
      if (current < 0) return 0;
      return opts.wrap ? (current + 1) % count : Math.min(current + 1, count - 1);
    case "ArrowUp":
      if (opts.wrap) return current <= 0 ? count - 1 : current - 1;
      return current <= 0 ? -1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Wait this long after the last keystroke before searching as the person types. */
export const TYPE_DELAY_MS = 250;

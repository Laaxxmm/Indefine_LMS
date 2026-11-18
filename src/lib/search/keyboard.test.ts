// Keyboard rules for the /search results (no wrap, Up from the first goes back to the box) and the
// command palette (wraps), and the Ctrl/⌘+K shortcut.
import { describe, expect, it } from "vitest";
import { isPaletteShortcut, moveActive } from "./keyboard";

describe("isPaletteShortcut", () => {
  it("Ctrl+K and ⌘+K, either case; not with Alt or Shift, not K alone", () => {
    expect(isPaletteShortcut({ key: "k", ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "K", metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "k" })).toBe(false);
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, altKey: true })).toBe(false);
    expect(isPaletteShortcut({ key: "j", ctrlKey: true })).toBe(false);
  });
});

describe("moveActive on the page (no wrap)", () => {
  const page = (key: string, at: number, n = 3) => moveActive(key, at, n, { wrap: false });
  it("Down from the box enters the results and stops at the last", () => {
    expect(page("ArrowDown", -1)).toBe(0);
    expect(page("ArrowDown", 1)).toBe(2);
    expect(page("ArrowDown", 2)).toBe(2);
  });
  it("Up from the first result goes back to the box", () => {
    expect(page("ArrowUp", 2)).toBe(1);
    expect(page("ArrowUp", 0)).toBe(-1);
  });
  it("Home and End jump; other keys are not moves", () => {
    expect(page("Home", 2)).toBe(0);
    expect(page("End", 0)).toBe(2);
    expect(page("Enter", 1)).toBeNull();
    expect(page("a", 1)).toBeNull();
  });
});

describe("moveActive in the palette (wraps)", () => {
  const pal = (key: string, at: number, n = 3) => moveActive(key, at, n, { wrap: true });
  it("Down and Up cycle", () => {
    expect(pal("ArrowDown", -1)).toBe(0);
    expect(pal("ArrowDown", 2)).toBe(0);
    expect(pal("ArrowUp", 0)).toBe(2);
    expect(pal("ArrowUp", -1)).toBe(2);
  });
  it("no results: arrows keep nothing active", () => {
    expect(pal("ArrowDown", -1, 0)).toBe(-1);
    expect(pal("Home", -1, 0)).toBeNull();
  });
});

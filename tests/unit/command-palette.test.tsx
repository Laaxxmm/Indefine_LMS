// CommandPalette: renders nothing until opened; open, it is a labelled modal dialog with a combobox
// search box tied to a results listbox, a close button and the keyboard tip. The key handling rules
// themselves are unit-tested in src/lib/search/keyboard.test.ts (no browser DOM in this suite).
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHtml } from "./routes/harness";

vi.mock("next/navigation", async () => (await import("./routes/harness")).navigationMock);

const { CommandPalette, OPEN_PALETTE_EVENT, openCommandPalette } = await import("@/components/CommandPalette");
const { KEYS_TIP, PALETTE_TIP } = await import("@/lib/search/copy");

const html = async (open: boolean) => (await renderHtml(<CommandPalette defaultOpen={open} />)).replace(/<!-- -->/g, "");

afterEach(() => vi.unstubAllGlobals());

describe("CommandPalette", () => {
  it("renders nothing while closed", async () => {
    expect(await html(false)).toBe("");
  });

  it("open: a modal dialog labelled by its visible title", async () => {
    const out = await html(true);
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/role="dialog"[^>]*tabindex="-1"/); // a click on its text keeps focus inside
    const title = out.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(title).toBeTruthy();
    expect(out).toMatch(new RegExp(`<label id="${title}"[^>]*>Search Firm OS</label>`));
  });

  it("the search box is a combobox tied to the results listbox, with a hint", async () => {
    const out = await html(true);
    const input = out.match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-autocomplete="list"');
    const list = input.match(/aria-controls="([^"]+)"/)?.[1];
    expect(out).toMatch(new RegExp(`id="${list}" role="listbox" aria-label="Search results"`));
    const hint = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(out).toMatch(new RegExp(`id="${hint}"[^>]*>${PALETTE_TIP}<`));
    expect(input).toContain("focus-visible:ring-2");
  });

  it("has a labelled close button, the keyboard tip, and a live region", async () => {
    const out = await html(true);
    expect(out).toMatch(/<button[^>]*aria-label="Close search"/);
    expect(out).toContain(KEYS_TIP);
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("bg-ink/60"); // backdrop through the theme
  });

  it("openCommandPalette() dispatches the open event on window", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    target.addEventListener(OPEN_PALETTE_EVENT, (e) => seen.push(e.type));
    vi.stubGlobal("window", target);
    openCommandPalette();
    expect(seen).toEqual([OPEN_PALETTE_EVENT]);
  });
});

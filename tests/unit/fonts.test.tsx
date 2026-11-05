// The brand fonts load: next/font self-hosts Plus Jakarta Sans and Schibsted Grotesk and sets their
// CSS variables on <html>; Tailwind's font-sans / font-display read those variables; and globals.css
// has no @import (one would land after the Tailwind rules in the built CSS, where browsers ignore it,
// so the fonts never loaded). `npx next build` then shows @font-face rules in the built CSS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => [] as { family: string; opts: Record<string, unknown> }[]);
vi.mock("next/font/google", () => ({
  Plus_Jakarta_Sans: (opts: Record<string, unknown>) => (calls.push({ family: "Plus Jakarta Sans", opts }), { variable: "jakarta-var-class" }),
  Schibsted_Grotesk: (opts: Record<string, unknown>) => (calls.push({ family: "Schibsted Grotesk", opts }), { variable: "schibsted-var-class" }),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("brand fonts", () => {
  it("are loaded with next/font as CSS variables on <html>", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const el = (await RootLayout({ children: null })) as ReactElement<{ className: string }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.props.className.split(" ")).toEqual(expect.arrayContaining(["jakarta-var-class", "schibsted-var-class", "font-sans"]));
    expect(calls).toEqual([
      { family: "Plus Jakarta Sans", opts: expect.objectContaining({ variable: "--font-sans", subsets: ["latin"], display: "swap" }) },
      { family: "Schibsted Grotesk", opts: expect.objectContaining({ variable: "--font-display", subsets: ["latin"], display: "swap" }) },
    ]);
  });

  it("Tailwind's font families read those variables first", async () => {
    const { default: config } = await import("../../tailwind.config");
    const fonts = (config.theme?.extend as { fontFamily: Record<string, string[]> }).fontFamily;
    expect(fonts.sans[0]).toBe("var(--font-sans)");
    expect(fonts.display[0]).toBe("var(--font-display)");
  });

  it("globals.css imports nothing (an @import after the Tailwind rules is ignored by browsers)", () => {
    expect(read("src/app/globals.css")).not.toMatch(/@import\b/);
    expect(read("src/app/globals.css")).not.toContain("fonts.googleapis.com");
  });
});

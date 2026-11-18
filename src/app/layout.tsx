import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Schibsted_Grotesk } from "next/font/google";
import { auth } from "@/lib/auth";
import { CommandPalette } from "@/components/CommandPalette";
import { isModuleEnabled } from "@/lib/workspace/settings";
import "./globals.css";

// The brand fonts, downloaded at build time and served from this app (no request to Google from the
// browser, so the CSP's font-src 'self' covers them). Both are variable fonts: every weight the
// pages use (400–900) comes from one file each. Tailwind's font-sans / font-display read the variables.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Indefine LMS",
  description: "Internal learning portal",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The command palette (Ctrl/Cmd+K, or a header's Search button) is mounted once, here, for people
  // with the Search module on: its role rule, the Firm OS master switch and the workspace settings.
  // It renders nothing until it is opened.
  const session = await auth();
  const palette = !!session?.user && (await isModuleEnabled(session.user, "search"));
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} font-sans`}>
      <body className="antialiased text-ink selection:bg-brand-500/15">
        {children}
        {palette && <CommandPalette />}
      </body>
    </html>
  );
}

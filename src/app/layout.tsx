import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { CommandPalette } from "@/components/CommandPalette";
import { isModuleEnabled } from "@/lib/workspace/settings";
import "./globals.css";

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
    <html lang="en" className="font-sans">
      <body className="antialiased text-ink selection:bg-brand-500/15">
        {children}
        {palette && <CommandPalette />}
      </body>
    </html>
  );
}

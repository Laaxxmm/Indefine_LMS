import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indefine LMS",
  description: "Internal learning portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="font-sans">
      <body className="antialiased text-white/90 selection:bg-brand-500/30">
        {children}
      </body>
    </html>
  );
}

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
      <body className="antialiased text-ink selection:bg-brand-500/15">
        {children}
      </body>
    </html>
  );
}

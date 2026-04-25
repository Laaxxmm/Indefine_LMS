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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (v2) pulls in pdfjs-dist; keep it external so Next doesn't bundle the
  // worker/canvas internals — it runs in the Node runtime on the tax-tool routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    // Course handouts (zipped working papers, formats, PDF sets) go up through a
    // server action, so the cap has to clear a realistic attachment. Anything
    // over this is refused with a message rather than crashing the page.
    serverActions: { bodySizeLimit: "60mb" },
  },
  // Only the CSP directives that can't break anything the app loads (Next's inline
  // bootstrap, Google Fonts, SharePoint video). A full script-src needs nonces.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;

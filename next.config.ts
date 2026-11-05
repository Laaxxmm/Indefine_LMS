import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/hardening/security-headers";

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
  // Security headers on every path, CSP included (Phase 11). The policy and the reason for each
  // directive live in src/lib/hardening/security-headers.ts (tested there). Scripts still allow
  // 'unsafe-inline' because the App Router bootstraps with inline scripts; nonces are the next step.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }) }];
  },
  poweredByHeader: false,
};

export default nextConfig;

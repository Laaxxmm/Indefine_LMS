import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/hardening/security-headers";

const nextConfig: NextConfig = {
  // pdf-parse (v2) pulls in pdfjs-dist; keep it external so Next doesn't bundle the
  // worker/canvas internals — it runs in the Node runtime on the tax-tool routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    // The largest legitimate server-action body is a course handout or live-session material
    // (/admin/video/[id], /admin/live: "up to 50 MB per file"), so the ceiling is 50 MB + framing.
    // Every other path is held far lower BEFORE Next decodes the body: src/middleware.ts refuses
    // by Content-Length (64 KB anonymous, 2 MB signed in; src/lib/hardening/body-limits.ts).
    // Move those two uploads to route handlers (readUploadForm) and this can drop to "2mb".
    serverActions: { bodySizeLimit: "51mb" },
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

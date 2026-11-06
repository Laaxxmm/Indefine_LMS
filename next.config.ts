import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/hardening/security-headers";

const nextConfig: NextConfig = {
  // pdf-parse (v2) pulls in pdfjs-dist; keep it external so Next doesn't bundle the
  // worker/canvas internals — it runs in the Node runtime on the tax-tool routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    // Server actions take no file uploads (re-audit NEW-6: the course-handout and live-session
    // material uploads are route handlers that read the body with a running byte count), so the
    // ceiling is the signed-in tier. src/middleware.ts already refuses larger bodies by
    // Content-Length, and bodies with no length, before Next decodes them
    // (src/lib/hardening/body-limits.ts SERVER_ACTION_BODY_LIMIT; a test keeps the two in step).
    serverActions: { bodySizeLimit: "2mb" },
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

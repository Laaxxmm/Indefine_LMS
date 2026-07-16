import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (v2) pulls in pdfjs-dist; keep it external so Next doesn't bundle the
  // worker/canvas internals — it runs in the Node runtime on the tax-tool routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.sharepoint.com" },
      { protocol: "https", hostname: "*.onedrive.live.com" },
      { protocol: "https", hostname: "graph.microsoft.com" },
    ],
  },
};

export default nextConfig;

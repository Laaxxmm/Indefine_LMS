import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

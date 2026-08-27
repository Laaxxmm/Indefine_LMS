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
};

export default nextConfig;

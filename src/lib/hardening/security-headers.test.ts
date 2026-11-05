import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const directives = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)] as const));

describe("Content-Security-Policy", () => {
  it("production: no eval, no third-party scripts, nothing may frame us, plugins off, HTTPS only", () => {
    const d = directives(contentSecurityPolicy());
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("frame-src")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'", "https://login.microsoftonline.com"]);
    expect(d.has("upgrade-insecure-requests")).toBe(true);
    expect(contentSecurityPolicy()).not.toMatch(/unsafe-eval|\*(?!\.sharepoint\.com)|http:/);
  });

  it("allows exactly what the app loads: Google Fonts, SharePoint images and video, data:/blob: images", () => {
    const d = directives(contentSecurityPolicy());
    expect(d.get("style-src")).toContain("https://fonts.googleapis.com");
    expect(d.get("font-src")).toEqual(["'self'", "https://fonts.gstatic.com", "data:"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:", "blob:", "https://*.sharepoint.com"]);
    expect(d.get("media-src")).toEqual(["'self'", "blob:", "https://*.sharepoint.com"]);
    expect(d.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("development adds only what next dev needs (eval for React Refresh, websockets for HMR)", () => {
    const d = directives(contentSecurityPolicy({ dev: true }));
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(d.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
    expect(d.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("next.config.ts headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends the CSP and keeps every header the app already sent, on every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toBe(contentSecurityPolicy());
    // Pre-Phase-11 headers, unchanged or tightened.
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/^camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)/);
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    // Security audit: no Cross-Origin-Resource-Policy was sent; now same-origin on every path.
    expect(h["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("uses the dev policy only under next dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const rules = await nextConfig.headers!();
    expect(rules[0].headers.find((x) => x.key === "Content-Security-Policy")?.value).toContain("'unsafe-eval'");
    expect(securityHeaders({ dev: true })).toHaveLength(securityHeaders().length);
  });
});

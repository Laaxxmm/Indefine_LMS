// Security headers for every response (Phase 11), imported by next.config.ts. Pure: no imports, so
// the config loader can compile it on its own.
//
// Content-Security-Policy, built for what this app actually loads:
//   scripts   'self' + 'unsafe-inline': the App Router streams its bootstrap as inline <script>s
//             (self.__next_f.push) and the engagement-letter editor is a self-contained HTML page
//             with an inline script. Nonces would need middleware on every request and would make
//             every page dynamic; that is the next step, not this one. 'unsafe-eval' only in dev
//             (React Refresh). No third-party script origin is allowed.
//   styles    'self' + 'unsafe-inline' (React style props, the editor page). No third-party style origin.
//   fonts     'self' + data:. The brand fonts are self-hosted by next/font (src/app/layout.tsx): no Google host.
//   images    'self' data: blob: (the letterhead is inlined as data:, the editor previews a chosen
//             signature through a blob: URL) + SharePoint.
//   media     'self' blob: + SharePoint (training videos stream from a Graph download URL).
//   connect   'self' only (every fetch goes to our /api routes); dev adds ws: for HMR.
//   frames    none may embed us (frame-ancestors 'none'); we embed nothing (frame-src 'none').
//   forms     'self' + the Microsoft sign-in host (NextAuth's sign-in POST redirects there).
//   object-src 'none', base-uri 'self', worker-src 'self' blob: (canvas-confetti), upgrade-insecure-requests in production.
// The pre-Phase-11 header kept only frame-ancestors / object-src / base-uri; all three remain.

export const SHAREPOINT = "https://*.sharepoint.com";
export const MS_LOGIN = "https://login.microsoftonline.com";

export function contentSecurityPolicy(opts: { dev?: boolean } = {}): string {
  const dev = !!opts.dev;
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["font-src", ["'self'", "data:"]],
    ["img-src", ["'self'", "data:", "blob:", SHAREPOINT]],
    ["media-src", ["'self'", "blob:", SHAREPOINT]],
    ["connect-src", ["'self'", ...(dev ? ["ws:", "wss:"] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", MS_LOGIN]],
  ];
  const parts = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export type Header = { key: string; value: string };

/** The headers next.config.ts sends on every path. */
export function securityHeaders(opts: { dev?: boolean } = {}): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    // Popups we open (Teams meeting join) keep working; nothing else shares our browsing context.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    // No other site may embed our responses (an <img>/<script>/no-cors fetch of /api/... from a
    // foreign page is blocked by the browser): deliverables, exports and JSON stay same-origin.
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ];
}

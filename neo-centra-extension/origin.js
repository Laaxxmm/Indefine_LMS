// The one rule for the LMS address this extension may send the Turia session to, shared by the
// service worker (checked again at run time) and build.mjs (checked at build time).
// https://host[:port], or http://localhost[:port] for a dev server. No path, query, credentials,
// and never a government host.
export function checkOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) return null;
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  if (/\.gov\.in$/i.test(url.hostname)) return null;
  return url.origin;
}

// Optional build: a copy of the extension for another Firm OS address (staging, a local dev
// server). Node only, no dependencies, no network.
//
//   node firm-os-companion-extension/build.mjs --origin=https://staging.example.in
//
// Writes firm-os-companion-extension/dist/ (git-ignored) with the address replaced in the three
// places that must agree: config.js (LMS_ORIGIN), manifest.json host_permissions, and the
// manifest's connect-src. Load dist/ unpacked. Without a build, load the folder itself
// (https://lms.indefine.in).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://lms.indefine.in";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const FILES = ["manifest.json", "background.js", "config.js", "core.js", "api.js", "storage.js", "sidepanel.html", "sidepanel.js", "options.html", "options.js", "styles.css"];

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

/** https://host[:port], or http://localhost[:port] for a dev server. Nothing else. */
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
  if (/\.gov\.in$/i.test(url.hostname)) return null; // never a government host
  return url.origin;
}

function build(argv) {
  const arg = argv.find((a) => a.startsWith("--origin="));
  if (!arg) fail("pass --origin=https://<your Firm OS host>");
  const origin = checkOrigin(arg.slice("--origin=".length));
  if (!origin) fail("the origin must be https://<host> (or http://localhost:<port>) with no path");

  if (!existsSync(out)) mkdirSync(out);
  for (const f of readdirSync(here).filter((f) => FILES.includes(f))) copyFileSync(join(here, f), join(out, f));

  const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${origin}/*`];
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(`connect-src ${DEFAULT_ORIGIN}`, `connect-src ${origin}`);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const config = readFileSync(join(here, "config.js"), "utf8").replace(`"${DEFAULT_ORIGIN}"`, JSON.stringify(origin));
  writeFileSync(join(out, "config.js"), config);

  console.log(`build: dist/ written for ${origin}. Load it unpacked from chrome://extensions.`);
}

// Runs only as a script (`node build.mjs ...`); importing it (the repo's tests) just gets checkOrigin.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build(process.argv);

// Optional build: a copy of the extension for another LMS address (staging, a local dev server).
// Node only, no dependencies, no network.
//
//   node neo-centra-extension/build.mjs --origin=https://staging.example.in
//
// Writes neo-centra-extension/dist/ (git-ignored) with the address replaced in the three places
// that must agree: config.js (LMS_ORIGIN), the LMS entry of manifest.json host_permissions, and
// the manifest's connect-src. Load dist/ unpacked. Without a build, load the folder itself
// (https://lms.indefine.in). The address is validated by origin.js — the same rule the service
// worker applies again at run time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOrigin } from "./origin.js";

export { checkOrigin };

const DEFAULT_ORIGIN = "https://lms.indefine.in";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const FILES = ["manifest.json", "background.js", "config.js", "origin.js", "popup.html", "popup.js"];

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

/** The manifest and config.js for `origin` (pure; exported for the tests). */
export function rewrite(manifestJson, configJs, origin) {
  const manifest = JSON.parse(manifestJson);
  manifest.host_permissions = manifest.host_permissions.map((p) => (p === `${DEFAULT_ORIGIN}/*` ? `${origin}/*` : p));
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(`connect-src ${DEFAULT_ORIGIN}`, `connect-src ${origin}`);
  const config = configJs.replace(`"${DEFAULT_ORIGIN}"`, JSON.stringify(origin));
  return { manifest: JSON.stringify(manifest, null, 2) + "\n", config };
}

function build(argv) {
  const arg = argv.find((a) => a.startsWith("--origin="));
  if (!arg) fail("pass --origin=https://<your LMS host>");
  const origin = checkOrigin(arg.slice("--origin=".length));
  if (!origin) fail("the origin must be https://<host> (or http://localhost:<port>) with no path");

  if (!existsSync(out)) mkdirSync(out);
  for (const f of readdirSync(here).filter((f) => FILES.includes(f))) copyFileSync(join(here, f), join(out, f));
  const { manifest, config } = rewrite(readFileSync(join(here, "manifest.json"), "utf8"), readFileSync(join(here, "config.js"), "utf8"), origin);
  writeFileSync(join(out, "manifest.json"), manifest);
  writeFileSync(join(out, "config.js"), config);
  console.log(`build: dist/ written for ${origin}. Load it unpacked from chrome://extensions.`);
}

// Runs only as a script (`node build.mjs ...`); importing it (the repo's tests) just gets the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build(process.argv);

// Repo scan of firm-os-companion-extension/ (orchestrator NON-NEGOTIABLE 1): the companion only
// displays steps and copy values. It must have no content scripts, no permission beyond sidePanel
// and storage, host access to the Firm OS origin only, one network call (to that origin), and no
// way to touch a page in a tab. Also: no government portal host anywhere in the extension or the
// companion's server code, and no delete path in either.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_HOST_RE, checkNoDelete, checkNoPortal } from "../../scripts/lib/guards";
import { listRepoFiles } from "../../scripts/lib/repo-files";
import { COMPANION_EXTENSION_ID } from "@/lib/companion/config";

const ROOT = join(__dirname, "..", "..");
const DIR = "firm-os-companion-extension/";
const LMS_ORIGIN = "https://lms.indefine.in";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Tracked and untracked-but-not-ignored files, exactly as the guards see them (dist/ is ignored).
const files = listRepoFiles().filter((p) => p.startsWith(DIR));
const manifest = JSON.parse(read(`${DIR}manifest.json`)) as Record<string, unknown> & {
  permissions?: string[];
  host_permissions?: string[];
  content_security_policy?: { extension_pages?: string };
  side_panel?: { default_path?: string };
  options_ui?: { page?: string };
  background?: { service_worker?: string };
  key?: string;
};
const shippedJs = files.filter((p) => /\.(js|mjs)$/.test(p) && !p.endsWith("build.mjs"));
const html = files.filter((p) => p.endsWith(".html"));
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, ""); // comments may describe what the code never does

describe("firm-os-companion-extension: manifest", () => {
  it("is MV3 with a side panel and an options page", () => {
    expect(files).toContain(`${DIR}manifest.json`);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
    expect(files).toContain(`${DIR}${manifest.side_panel?.default_path}`);
    expect(files).toContain(`${DIR}${manifest.options_ui?.page}`);
    expect(files).toContain(`${DIR}${manifest.background?.service_worker}`);
  });

  it("has no content scripts and nothing that reaches into pages or other extensions", () => {
    for (const k of ["content_scripts", "web_accessible_resources", "externally_connectable", "optional_permissions", "optional_host_permissions", "declarative_net_request", "chrome_url_overrides", "devtools_page"]) {
      expect(manifest, k).not.toHaveProperty(k);
    }
  });

  it("asks only for sidePanel and storage", () => {
    const allowed = new Set(["sidePanel", "storage"]);
    expect(manifest.permissions?.length).toBeGreaterThan(0);
    for (const p of manifest.permissions ?? []) expect(allowed.has(p), p).toBe(true);
  });

  it("has host access to the Firm OS origin only, and its CSP lets it connect nowhere else", () => {
    expect(manifest.host_permissions).toEqual([`${LMS_ORIGIN}/*`]);
    const csp = manifest.content_security_policy?.extension_pages ?? "";
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `))?.slice(name.length + 1).trim();
    expect(directive("connect-src")).toBe(LMS_ORIGIN);
    expect(directive("script-src")).toBe("'self'");
    expect(directive("default-src")).toBe("'self'");
    expect(directive("object-src")).toBe("'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)|\*/);
  });

  it("its public key gives the fixed id the API allows by default", () => {
    const der = Buffer.from(manifest.key ?? "", "base64");
    const id = createHash("sha256").update(der).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
    expect(id).toBe(COMPANION_EXTENSION_ID);
    expect(JSON.stringify(manifest)).not.toMatch(/PRIVATE KEY/);
  });
});

describe("firm-os-companion-extension: code", () => {
  it("never touches a page in a tab (no scripting, tabs, executeScript, cookies, debugger, web requests)", () => {
    const banned = /chrome\.(scripting|tabs|cookies|debugger|webRequest|declarativeNetRequest|windows|history|bookmarks|downloads|identity|management)\b|executeScript|insertCSS|document\.cookie/;
    for (const p of [...shippedJs, ...files.filter((f) => f.endsWith("build.mjs"))]) expect(code(p), p).not.toMatch(banned);
  });

  it("builds the DOM with textContent only: no HTML parsing, eval or inline handlers", () => {
    for (const p of shippedJs) expect(code(p), p).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|DOMParser/);
    for (const p of html) {
      const h = read(p);
      expect(h, p).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i); // no inline script
      expect(h, p).not.toMatch(/\son[a-z]+\s*=/i); // no inline handlers
      expect(h, p).not.toMatch(/\sstyle\s*=/i); // CSP style-src 'self'
      expect(h, p).not.toMatch(/<(iframe|object|embed|form[^>]*\baction=)/i);
      for (const [, src] of h.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) expect(files, `${p} loads ${src}`).toContain(`${DIR}${src}`);
    }
  });

  it("has exactly one network call: a GET to the Firm OS origin, without cookies, refusing redirects", () => {
    const network = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|navigator\.connect/;
    const withNetwork = shippedJs.filter((p) => network.test(code(p)));
    expect(withNetwork).toEqual([`${DIR}api.js`]);
    const api = code(`${DIR}api.js`);
    expect(api.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(api).toMatch(/fetch\(nextTaskUrl\(LMS_ORIGIN\)/);
    expect(api).toMatch(/method:\s*"GET"/);
    expect(api).toMatch(/credentials:\s*"omit"/);
    expect(api).toMatch(/redirect:\s*"error"/);
    for (const p of shippedJs) expect(code(p), p).not.toMatch(/method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i);
    expect(code(`${DIR}build.mjs`)).not.toMatch(network);
  });

  it("names no host but Firm OS, and LMS_ORIGIN is that host", () => {
    expect(read(`${DIR}config.js`)).toContain(`export const LMS_ORIGIN = "${LMS_ORIGIN}";`);
    for (const p of [...shippedJs, ...html, `${DIR}manifest.json`]) {
      const hosts = [...read(p).matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
      for (const h of hosts) expect(h, `${p} names ${h}`).toBe("lms.indefine.in");
    }
  });

  it("stores only the pairing token (local) and step ticks (session)", () => {
    const store = code(`${DIR}storage.js`);
    expect([...store.matchAll(/chrome\.storage\.(\w+)\.set\(\{\s*(\w+)/g)].map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(["local.pairingToken", "local.pairingToken", "session.stepTicks"]);
    for (const p of shippedJs.filter((f) => !f.endsWith("storage.js"))) expect(code(p), p).not.toMatch(/chrome\.storage\.(local|session|sync)\.set|localStorage|indexedDB/);
  });
});

describe("no portal host, no delete path", () => {
  const scanned = listRepoFiles()
    .filter((p) => p.startsWith(DIR) || p.startsWith("src/lib/companion/") || p.startsWith("src/app/companion/") || p.startsWith("src/app/api/firm-os/companion/"))
    .map((path) => ({ path, content: read(path) }));

  it("no government portal hostname in the extension or the companion's server code", () => {
    expect(scanned.length).toBeGreaterThan(20);
    for (const f of scanned) expect(PORTAL_HOST_RE.test(f.content), f.path).toBe(false);
    expect(checkNoPortal(scanned)).toEqual([]);
  });

  it("no delete path (the Firm OS no-delete rules, applied to the companion's server code as well)", () => {
    // checkNoDelete only scans its scope; present the companion's lib/page paths under a Firm OS dir.
    const asFirmOs = scanned.map((f) => (f.path.startsWith(DIR) || f.path.startsWith("src/app/api/firm-os/") ? f : { ...f, path: `src/lib/agents/__companion__/${f.path}` }));
    expect(checkNoDelete(asFirmOs)).toEqual([]);
    for (const f of scanned.filter((x) => /\.(ts|tsx|js|mjs)$/.test(x.path))) expect(f.content, f.path).not.toMatch(/\.delete\s*\(/);
  });

  it("the companion's server code makes no outbound request and sends nothing", () => {
    for (const f of scanned.filter((x) => x.path.startsWith("src/") && !x.path.includes("__tests__"))) {
      expect(f.content, f.path).not.toMatch(/\bfetch\s*\(|sendMail|graph\.microsoft|nodemailer|smtp/i);
    }
  });
});

describe("README", () => {
  it("covers install (load unpacked), pairing and a privacy note", () => {
    const readme = read(`${DIR}README.md`);
    expect(readme).toMatch(/## Install/);
    expect(readme).toMatch(/Load unpacked/);
    expect(readme).toMatch(/## Pair it with Firm OS/);
    expect(readme).toMatch(/## Privacy/);
    expect(readme).toMatch(/Stored in this browser/);
    expect(readme).toMatch(/\*\*Never:\*\*/);
  });
});

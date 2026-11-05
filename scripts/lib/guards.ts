// Firm OS guard rules (orchestrator NON-NEGOTIABLES 1-4). Pure functions: each takes the
// repo's files as { path, content } and returns violations; scripts/verify-*.ts are thin CLIs.
//
// These files must not trip their own rules, so every forbidden literal below is assembled
// from pieces ("gst" + ".gov.in" style). Keep it that way when editing.

export type SourceFile = { path: string; content: string };
export type Violation = { path: string; line: number; rule: string; snippet: string };

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
const under = (p: string, dir: string) => (dir.endsWith("/") ? p.startsWith(dir) : p === dir || p.startsWith(dir + "/"));
const ext = (p: string) => (p.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
const snip = (s: string) => {
  const t = s.trim();
  return t.length > 160 ? t.slice(0, 157) + "..." : t;
};
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Every line matching `re` becomes a violation. `re` must not be global. */
function scanLines(file: SourceFile, rule: string, re: RegExp, out: Violation[], skip?: (line: string, m: RegExpMatchArray) => boolean) {
  const lines = file.content.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(re);
    if (m && !skip?.(line, m)) out.push({ path: norm(file.path), line: i + 1, rule, snippet: snip(line) });
  });
}

// ------------------------------------------------------------------ shared scope

/** Firm OS code. Never allowlisted for portal hosts; the no-delete rule applies to all of it. */
export const FIRM_OS_DIRS = [
  "src/lib/ai",
  "src/lib/agents",
  "src/lib/integrations",
  "src/lib/close-loop",
  "src/app/onboard",
  "src/app/agents",
  "src/app/coach",
  "src/app/comms",
  "src/app/admin/firm-os",
  "src/app/api/firm-os",
  "src/app/api/cron/firm-os",
  "src/lib/rbac",
  "src/lib/audit",
  "src/lib/hardening",
];
export const isFirmOs = (p: string) => FIRM_OS_DIRS.some((d) => under(norm(p), d));

// ------------------------------------------------------------------ no-skip

const NO_SKIP_ROOTS = ["src", "tests", "scripts"];
const NO_SKIP_EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const TEST_FNS = "(?:describe|it|test|suite|bench)";
const NO_SKIP_RULES: [string, RegExp][] = [
  ["no-skip:skip", new RegExp("\\." + "skip(?:If)?\\s*\\(")],
  ["no-skip:only", new RegExp("\\." + "only\\s*\\(")],
  ["no-skip:x-prefixed", new RegExp("(?<![\\w$.])(?:xit|xdescribe|xtest)\\s*\\(")],
  ["no-skip:todo", new RegExp("(?<![\\w$])" + TEST_FNS + "(?:\\.\\w+)*\\.todo\\s*\\(")],
];

export function checkNoSkip(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const p = norm(f.path);
    if (!NO_SKIP_ROOTS.some((r) => under(p, r)) || !NO_SKIP_EXT.has(ext(p))) continue;
    for (const [rule, re] of NO_SKIP_RULES) scanLines(f, rule, re, out);
  }
  return out;
}

// ------------------------------------------------------------------ secrets

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".svgz", ".zip", ".gz", ".tgz", ".7z", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".webm", ".wav",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".exe", ".dll", ".so", ".node", ".wasm",
]);
const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "npm-shrinkwrap.json"]);

/** Files the secret scan looks at: tracked text files outside node_modules, minus lockfiles and binaries. */
export function isSecretScanCandidate(path: string): boolean {
  const p = norm(path);
  const base = p.split("/").pop() ?? p;
  if (p.split("/").includes("node_modules")) return false;
  if (LOCKFILES.has(base)) return false;
  return !BINARY_EXT.has(ext(p));
}

const B = "(?<![A-Za-z0-9_-])"; // token start boundary
const SECRET_RULES: [string, RegExp][] = [
  ["secret:anthropic-key", new RegExp(B + "sk-" + "ant-[A-Za-z0-9_-]{8,}")],
  ["secret:xai-key", new RegExp(B + "xai-" + "[A-Za-z0-9]{20,}")],
  ["secret:openai-key", new RegExp(B + "sk-" + "(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")],
  ["secret:aws-access-key", new RegExp(B + "AKIA" + "[0-9A-Z]{16}(?![0-9A-Z])")],
  ["secret:private-key", new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH |DSA |ENCRYPTED |)" + "PRIVATE KEY-----")],
  ["secret:github-token", new RegExp(B + "(?:gh" + "[pousr]_[A-Za-z0-9]{30,}|github" + "_pat_[A-Za-z0-9_]{20,})")],
  ["secret:google-api-key", new RegExp(B + "AI" + "za[0-9A-Za-z_-]{35}")],
  [
    "secret:jwt",
    new RegExp(
      "(?:secret|token|jwt|auth|bearer|session|password|api[_-]?key|cookie)[\\w-]*[\"'`]?\\s*[:=]\\s*[\"'`]?(?:Bearer\\s+)?" +
        "ey" + "J[A-Za-z0-9_-]{8,}\\.ey" + "J[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
      "i",
    ),
  ],
];
// Generic "name = 'long literal'" assignment. Values with spaces or <...> are placeholders.
const GENERIC_SECRET = /(secret|password|passwd|api[_-]?key|token)[\w-]*["'`]?\s*[:=]\s*(["'])([^"'\s]{16,})\2/i;
const isPlaceholder = (v: string) => /[\s<>]/.test(v) || /^\$\{.*\}$/.test(v) || /^(x+|\*+|\.+)$/i.test(v);

const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$|(^|\/)[^/]+\.env\.example$/;
const ENV_SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|_KEY|PRIVATE)/i;

export function checkSecrets(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const p = norm(f.path);
    if (!isSecretScanCandidate(p)) continue;
    for (const [rule, re] of SECRET_RULES) scanLines(f, rule, re, out);
    scanLines(f, "secret:generic-assignment", GENERIC_SECRET, out, (_l, m) => isPlaceholder(m[3]));
    if (ENV_EXAMPLE.test(p)) {
      // Example env files may only carry empty or placeholder values for secret-ish keys.
      const re = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/;
      scanLines(f, "secret:env-example-value", re, out, (_l, m) => {
        if (!ENV_SECRET_NAME.test(m[1])) return true;
        const v = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
        return v === "" || isPlaceholder(v);
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ no-portal

const PORTAL_NAMES = ["gst", "mca", "incometax", "tdscpc"];
/** Exact host or any subdomain of it (www.x, services.x). `cbic-gst...` is a different host. */
export const PORTAL_HOST_RE = new RegExp("(?<![A-Za-z0-9-])(?:" + PORTAL_NAMES.join("|") + ")\\.gov\\.in(?![A-Za-z0-9-])", "i");
export const PORTAL_HOSTS = PORTAL_NAMES.map((n) => n + ".gov" + ".in");
const NO_PORTAL_ROOTS = ["src", "scripts", "statutory-extension", "neo-centra-extension"];

export type PortalAllow = {
  path: string;
  /**
   * read-only-scraper: GETs public notification listings. Any login/OTP/DSC token, form,
   *   .submit(), or a POST near a portal host fails.
   * document-text: the host is cited inside document wording. The file may not make any
   *   network call at all (stricter than the scraper rule), nor contain a form or .submit().
   */
  kind: "read-only-scraper" | "document-text";
  why: string;
};

/** Legacy LMS files that may mention the government portal hosts. Exact paths only. */
export const LEGACY_PORTAL_READONLY: PortalAllow[] = [
  {
    path: "src/lib/statutory/cloud.ts",
    kind: "read-only-scraper",
    why: "Statutory-updates cron: GETs the public Income-tax 'latest news' listing (no auth, no form post, no filing).",
  },
  {
    path: "statutory-extension/background.js",
    kind: "read-only-scraper",
    why: "Office-PC extension: opens the public GSTN news and MCA home pages in a background tab; its only POST goes to the LMS ingest API.",
  },
  {
    path: "statutory-extension/collectors.js",
    kind: "read-only-scraper",
    why: "Reads public notification lists from the open pages (credentials: 'omit'). Its one POST is the public What's-New search on the CBDT information site, a different host.",
  },
  {
    path: "statutory-extension/manifest.json",
    kind: "read-only-scraper",
    why: "host_permissions for the same public news pages the collector reads.",
  },
  {
    path: "src/lib/certificates/templates/format-vi.ts",
    kind: "document-text",
    why: "Certificate wording cites the Income-tax website as the source the CA verified; static text rendered into a DOCX, no network code.",
  },
];

const SUBMISSION_SIGNAL = /(?<![A-Za-z])(login|otp|dsc)|<form\b|\.submit\s*\(/i;
const POST_RE = /method\s*:\s*["'`]POST["'`]/i;
const NETWORK_RE = /\bfetch\s*\(|XMLHttpRequest|\baxios\b|\bhttps?\.(?:request|get)\s*\(|\bget(?:Text|Json)\s*\(|sendBeacon|new\s+WebSocket|\bmethod\s*:/;

export function checkNoPortal(files: SourceFile[], allowlist: PortalAllow[] = LEGACY_PORTAL_READONLY): Violation[] {
  const out: Violation[] = [];
  const allow = new Map(allowlist.map((a) => [norm(a.path), a]));
  for (const a of allow.values()) {
    if (isFirmOs(a.path)) out.push({ path: a.path, line: 0, rule: "no-portal:firm-os-allowlisted", snippet: "Firm OS code can never be on LEGACY_PORTAL_READONLY" });
  }
  for (const f of files) {
    const p = norm(f.path);
    if (!NO_PORTAL_ROOTS.some((r) => under(p, r)) || BINARY_EXT.has(ext(p))) continue;
    if (!PORTAL_HOST_RE.test(f.content)) continue;
    const entry = allow.get(p);
    if (!entry || isFirmOs(p)) {
      scanLines(f, "no-portal:host", PORTAL_HOST_RE, out);
      continue;
    }
    const lines = f.content.split(/\r?\n/);
    if (entry.kind === "read-only-scraper") {
      scanLines(f, "no-portal:submission-signal", SUBMISSION_SIGNAL, out);
      lines.forEach((line, i) => {
        if (!POST_RE.test(line)) return;
        const window = lines.slice(Math.max(0, i - 15), i + 2).join("\n");
        if (PORTAL_HOST_RE.test(window)) out.push({ path: p, line: i + 1, rule: "no-portal:post-to-portal", snippet: snip(line) });
      });
    } else {
      scanLines(f, "no-portal:network-call-in-document", NETWORK_RE, out);
      scanLines(f, "no-portal:submission-signal", /<form\b|\.submit\s*\(/i, out);
    }
  }
  return out;
}

// ------------------------------------------------------------------ no-delete

export const NO_DELETE_SCOPE = [...FIRM_OS_DIRS, "src/lib/audit", "src/lib/rbac", "scripts/verify-patha.ts", "scripts/map-legacy-folders.ts"];
export const inNoDeleteScope = (p: string) => NO_DELETE_SCOPE.some((d) => under(norm(p), d));

const VERB = "(?:delete|remove|purge|destroy|drop)(?![a-z])\\w*";
const GRAPH_DESTRUCTIVE = ["deleteDriveItem", "deleteEvent", "sendMailAsUser"];
const NO_DELETE_RULES: [string, RegExp][] = [
  ["no-delete:http-delete", /method\s*:\s*["'`]DELETE["'`]/i],
  ["no-delete:prisma-delete", /\.delete(?:Many)?\s*\(/],
  [
    "no-delete:exported-destructive-fn",
    new RegExp(
      "export\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*" + VERB + "|" +
        "export\\s+(?:const|let|var)\\s+" + VERB + "\\s*[:=]|" +
        "export\\s*\\{[^}]*(?<![\\w$])" + VERB + "(?:\\s+as\\s+\\w+)?\\s*[,}]",
    ),
  ],
  [
    "no-delete:destructive-method",
    new RegExp(
      "^\\s*(?:(?:public|private|protected|static|async|readonly|override|abstract)\\s+)*[\"']?" + VERB + "[\"']?\\s*" +
        // definition `name(a) {`, signature `name(a): T;` / `name(a): T {` (a bare call `name(a);` is not matched),
        // property `name: (..) =>` / `name: function`, field `name = (..) =>`
        "(?:\\??\\s*\\([^)]*\\)\\s*(?::[^=;{]+[{;]|\\{)|\\??\\s*:\\s*(?:async\\s*)?(?:\\(|function\\b|\\w+\\s*=>)|=\\s*(?:async\\s*)?\\()",
    ),
  ],
  ["no-delete:graph-member", new RegExp("\\.\\s*(?:" + GRAPH_DESTRUCTIVE.join("|") + ")\\b")],
];
const GRAPH_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@\/lib\/graph["']/g;

export type NoDeleteExemption = {
  /** Exact repo path of the one file. */
  path: string;
  /** The one exported function in it that may delete. */
  fn: string;
  /** The one Prisma model it may delete from: only `.<model>.deleteMany(` inside the function's body. */
  model: string;
  /** The decision that requires the delete. */
  adr: string;
  why: string;
};

/**
 * Deletes Firm OS code may contain: exactly ONE, required by ADR-006 (retention: break-nudge
 * heartbeats are kept 7 days and then deleted; they carry no business value). The exemption is as
 * narrow as the rule allows: in this one file, the declaration line of this one exported function
 * (rule no-delete:exported-destructive-fn) and `.activityHeartbeat.deleteMany(` lines inside that
 * function's body (rule no-delete:prisma-delete). Every other rule, line, function, model and file is
 * scanned exactly as before. Adding a second entry needs an ADR, like this one.
 */
export const NO_DELETE_EXEMPTIONS: readonly NoDeleteExemption[] = [
  {
    path: "src/lib/hardening/retention.ts",
    fn: "purgeExpiredHeartbeats",
    model: "activityHeartbeat",
    adr: "ADR-006",
    why: "ActivityHeartbeat (break-nudge signal) is kept 7 days, then deleted (ADR-006 retention table); the rows have no business value after the nudge window.",
  },
];

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 1-based [declaration line, body end line] of `export (async) function <fn>(` in `content`, or null. */
export function exportedFunctionRange(content: string, fn: string): [number, number] | null {
  const decl = new RegExp("^export\\s+(?:async\\s+)?function\\s+" + escRe(fn) + "\\s*\\(", "m");
  const hits = content.match(new RegExp(decl.source, "gm"));
  if (!hits || hits.length !== 1) return null; // missing or ambiguous: no exemption (fail closed)
  const start = content.search(decl);
  // Close the parameter list, then the body is the next `{ … }` (a return type with braces would be
  // taken as the body: the real body's lines would then fall outside and stay flagged — fail closed).
  let i = content.indexOf("(", start);
  let depth = 0;
  for (; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")" && --depth === 0) break;
  }
  const open = content.indexOf("{", i);
  if (open < 0) return null;
  depth = 0;
  let end = open;
  for (; end < content.length; end++) {
    if (content[end] === "{") depth++;
    else if (content[end] === "}" && --depth === 0) break;
  }
  if (depth !== 0) return null;
  const lineAt = (pos: number) => content.slice(0, pos).split(/\r?\n/).length;
  return [lineAt(start), lineAt(end)];
}

/** Whether a no-delete violation is covered by an exemption (see NO_DELETE_EXEMPTIONS). */
function isExempt(v: Violation, file: SourceFile, exemptions: readonly NoDeleteExemption[]): boolean {
  for (const e of exemptions) {
    if (norm(e.path) !== v.path) continue;
    const range = exportedFunctionRange(file.content, e.fn);
    if (!range) continue;
    const [first, last] = range;
    if (v.rule === "no-delete:exported-destructive-fn" && v.line === first) return true;
    if (v.rule === "no-delete:prisma-delete" && v.line > first && v.line <= last) {
      const line = file.content.split(/\r?\n/)[v.line - 1] ?? "";
      const all = line.match(/\.delete(?:Many)?\s*\(/g)?.length ?? 0;
      const allowed = line.match(new RegExp("\\." + escRe(e.model) + "\\.deleteMany\\s*\\(", "g"))?.length ?? 0;
      if (all > 0 && all === allowed) return true;
    }
  }
  return false;
}

export function checkNoDelete(files: SourceFile[], exemptions: readonly NoDeleteExemption[] = NO_DELETE_EXEMPTIONS): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const p = norm(f.path);
    if (!inNoDeleteScope(p) || !CODE_EXT.has(ext(p))) continue;
    const found: Violation[] = [];
    for (const [rule, re] of NO_DELETE_RULES) scanLines(f, rule, re, found);
    out.push(...found.filter((v) => !isExempt(v, f, exemptions)));
    for (const m of f.content.matchAll(GRAPH_IMPORT_RE)) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
      const bad = names.filter((n) => GRAPH_DESTRUCTIVE.includes(n));
      if (!bad.length) continue;
      const line = f.content.slice(0, m.index).split(/\r?\n/).length;
      out.push({ path: p, line, rule: "no-delete:graph-import", snippet: `imports ${bad.join(", ")} from @/lib/graph` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ ai-boundary

export const AI_PROVIDERS_DIR = "src/lib/ai/providers/";
const AI_SDKS = ["@anthropic-ai/sdk", "openai", "@google/generative-ai", "@google/genai"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const AI_IMPORT_RE = new RegExp(
  "(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s+)[\"'`](?:" + AI_SDKS.map(esc).join("|") + ")(?:/[^\"'`]*)?[\"'`]",
);
const AI_HOSTS = ["api.anthropic" + ".com", "api.x" + ".ai"];
const AI_HOST_RE = new RegExp("[\"'`][^\"'`]*(?:" + AI_HOSTS.map(esc).join("|") + ")");
const GEMINI_REST_RE = new RegExp(esc("generativelanguage" + ".googleapis.com"));

/** Legacy LMS files that call the Gemini REST API directly (pre-ModelRouter). No additions. */
export const LEGACY_GEMINI = ["src/lib/distill.ts", "src/lib/gemini.ts", "src/lib/quiz-gen.ts", "src/lib/transcribe.ts"];

export function checkAiBoundary(files: SourceFile[], legacyGemini: string[] = LEGACY_GEMINI): Violation[] {
  const out: Violation[] = [];
  const legacy = new Set(legacyGemini.map(norm));
  for (const f of files) {
    const p = norm(f.path);
    if (!CODE_EXT.has(ext(p)) || p.split("/").includes("node_modules")) continue;
    if (under(p, AI_PROVIDERS_DIR)) continue;
    scanLines(f, "ai-boundary:sdk-import", AI_IMPORT_RE, out);
    scanLines(f, "ai-boundary:provider-host", AI_HOST_RE, out);
    if (!legacy.has(p) || isFirmOs(p)) scanLines(f, "ai-boundary:gemini-rest", GEMINI_REST_RE, out);
  }
  return out;
}

export function formatViolation(v: Violation): string {
  return `${v.path}:${v.line}  ${v.rule}  ${v.snippet}`;
}

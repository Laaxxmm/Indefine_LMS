// Firm OS guard rules (orchestrator NON-NEGOTIABLES 1-4). Pure functions: each takes the
// repo's files as { path, content } and returns violations; scripts/verify-*.ts are thin CLIs.
//
// These files must not trip their own rules, so every forbidden literal below is assembled
// from pieces ("gst" + ".gov.in" style). Keep it that way when editing.

import ts from "typescript";

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
  "src/lib/search",
  "src/lib/corrections",
  "src/lib/privacy",
  "src/lib/workspace",
  "src/lib/errors",
  "src/app/search",
  "src/app/workspace",
  "src/app/focus",
  "firm-os-companion-extension",
  "src/lib/companion",
  "src/app/companion",
  "src/app/comms",
  "src/lib/agents/comms",
  "src/lib/integrations/outlook",
  "src/app/api/firm-os",
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
const NO_PORTAL_ROOTS = ["src", "scripts", "statutory-extension", "neo-centra-extension", "firm-os-companion-extension"];

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
  /** The Prisma models it may delete from: only `.<model>.deleteMany(` inside the function's body. */
  models: readonly string[];
  /** The decision that requires the delete. */
  adr: string;
  why: string;
};

/**
 * Deletes Firm OS code may contain: exactly ONE function, required by ADR-006 (retention): break-nudge
 * heartbeats are kept 7 days and then deleted (they carry no business value), and rate-limit buckets
 * whose window ended more than a day ago are deleted (pure request counters: no personal data, no
 * business record; an expired bucket limits nothing). The exemption is as narrow as the rule allows:
 * in this one file, the declaration line of this one exported function (rule
 * no-delete:exported-destructive-fn) and `.activityHeartbeat.deleteMany(` / `.rateLimitBucket.deleteMany(`
 * lines inside that function's body (rule no-delete:prisma-delete). Every other rule, line, function,
 * model and file is scanned exactly as before. Adding an entry or a model needs an ADR, like this one.
 */
export const NO_DELETE_EXEMPTIONS: readonly NoDeleteExemption[] = [
  {
    path: "src/lib/hardening/retention.ts",
    fn: "purgeExpiredRows",
    models: ["activityHeartbeat", "rateLimitBucket"],
    adr: "ADR-006",
    why: "ActivityHeartbeat (break-nudge signal) is kept 7 days, then deleted (ADR-006 retention table); the rows have no business value after the nudge window. RateLimitBucket rows (key, window start, count: no personal data) are deleted a day after their window ends (ADR-006 amendment 2026-11-06); an expired bucket limits nothing, so this only bounds the table.",
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
      const allowed = line.match(new RegExp("\\.(?:" + e.models.map(escRe).join("|") + ")\\.deleteMany\\s*\\(", "g"))?.length ?? 0;
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
//
// NON-NEGOTIABLE 3 (ADR-002): only src/lib/ai/providers/ talks to model hosts; the four legacy
// Gemini egress files (LEGACY_GEMINI) talk to Gemini only, and only the allow-listed callers
// (LEGACY_GEMINI_CALLERS) may import them, each reaching the mask gate (src/lib/ai/legacy-gate.ts).
//
// Two layers (security audit #19: the line grep alone had 12 bypasses):
//   line rules   (every code file, tests included — unchanged)  sdk-import / provider-host /
//                gemini-rest on single literals
//   AST rules    (TypeScript compiler API; every code file except tests and this guard)
//     ai-boundary:sdk-import        an AI SDK imported, required or dynamically imported — the
//                                   specifier is constant-folded ("a" + "b", consts, templates)
//     ai-boundary:provider-host     a string that folds (concatenation, consts, templates,
//                                   [..].join, "".concat, String.fromCharCode, Buffer.from(…,
//                                   "base64"), atob, or a base64 literal) to a known model host
//     ai-boundary:gemini-rest       the same for the Gemini REST host outside LEGACY_GEMINI
//     ai-boundary:egress-env        fetch() whose URL is built from an AI-ish environment variable
//                                   or whose options carry an AI key from the environment
//     ai-boundary:provider-import   a module under src/lib/ai/providers/ imported by anything but
//                                   the router (type-only imports are fine)
//     ai-boundary:legacy-import     a legacy Gemini egress module imported by a file not on
//                                   LEGACY_GEMINI_CALLERS, or by Firm OS code
//     ai-boundary:gate-missing      an allow-listed caller that no longer reaches the mask gate
//     ai-boundary:firm-os-reaches-gemini  Firm OS code whose import closure reaches legacy Gemini
//
// This file must not trip its own rules: hosts and SDK names are assembled from pieces, and the
// guard files are exempt from the AST rules.

export const AI_PROVIDERS_DIR = "src/lib/ai/providers/";
const AI_ROUTER = "src/lib/ai/router.ts";
const AI_SDKS = ["@anthropic-ai/sdk", "openai", "@google/generative-ai", "@google/genai"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const AI_IMPORT_RE = new RegExp(
  "(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s+)[\"'`](?:" + AI_SDKS.map(esc).join("|") + ")(?:/[^\"'`]*)?[\"'`]",
);
const AI_HOSTS = ["api.anthropic" + ".com", "api.x" + ".ai"];
const AI_HOST_RE = new RegExp("[\"'`][^\"'`]*(?:" + AI_HOSTS.map(esc).join("|") + ")");
const GEMINI_REST_RE = new RegExp(esc("generativelanguage" + ".googleapis.com"));

/** Every AI SDK package (and its sub-paths); scoped families by prefix. */
const AI_SDK_PACKAGES = [
  ...AI_SDKS,
  "@anthropic-ai/bedrock-sdk",
  "@anthropic-ai/vertex-sdk",
  "@google-cloud/vertexai",
  "@google-cloud/aiplatform",
  "@aws-sdk/client-bedrock-runtime",
  "@aws-sdk/client-bedrock",
  "@azure/openai",
  "@mistralai/mistralai",
  "cohere-ai",
  "groq-sdk",
  "together-ai",
  "ai",
  "langchain",
];
const AI_SDK_SCOPES = ["@ai-sdk/", "@langchain/"];
export const isAiSdk = (spec: string) => AI_SDK_PACKAGES.some((p) => spec === p || spec.startsWith(p + "/")) || AI_SDK_SCOPES.some((s) => spec.startsWith(s));

/** Model hosts other than Gemini (regex sources, assembled so this file never contains them). */
const PROVIDER_HOSTS = [
  esc("api.anthropic" + ".com"),
  esc("api.x" + ".ai"),
  esc("api.openai" + ".com"),
  "[a-z0-9-]+" + esc(".openai.azure" + ".com"),
  esc("openrouter" + ".ai"),
  esc("aiplatform.googleapis" + ".com"),
  "bedrock(?:-runtime|-agent-runtime)?" + esc(".") + "[a-z0-9-]+" + esc(".amazonaws" + ".com"),
  esc("api.groq" + ".com"),
  esc("api.together") + "\\.(?:xyz|ai)",
  esc("api.mistral" + ".ai"),
  esc("api.cohere") + "\\.(?:ai|com)",
  esc("api.deepseek" + ".com"),
  esc("api.perplexity" + ".ai"),
  esc("api.fireworks" + ".ai"),
];
const PROVIDER_HOST_ANY = new RegExp(PROVIDER_HOSTS.join("|"), "i");
const GEMINI_HOST_ANY = new RegExp(esc("generativelanguage" + ".googleapis.com"), "i");
/** Environment variables that point at a model endpoint or hold a model key. */
const AI_ENV_NAME = /(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|GENAI|XAI|GROK|OPENROUTER|MISTRAL|COHERE|GROQ|TOGETHER|DEEPSEEK|PERPLEXITY|BEDROCK|VERTEX|LLM|(?:^|_)AI(?:_|$)|MODEL)/i;
const AI_KEY_ENV = /(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|XAI|GROK|OPENROUTER|MISTRAL|COHERE|GROQ|TOGETHER|DEEPSEEK|PERPLEXITY)[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/i;

/** Legacy LMS files that call the Gemini REST API directly (pre-ModelRouter). No additions. */
export const LEGACY_GEMINI = ["src/lib/distill.ts", "src/lib/gemini.ts", "src/lib/quiz-gen.ts", "src/lib/transcribe.ts"];

/** A file allowed to import a legacy Gemini egress module: why, and the evidence that it reaches the mask gate. */
export type LegacyAiCaller = { path: string; why: string; gate: RegExp; gateNote: string };

/** The legacy Gemini callers (security audit #7 / #11 / #19). Exact paths; an addition needs a reason and a gate. */
export const LEGACY_GEMINI_CALLERS: readonly LegacyAiCaller[] = [
  {
    path: "src/lib/sop/gemini.ts",
    why: "SOP Builder: staff free text (≤ 50 KB) for analyze / generate.",
    gate: /callGemini\([^;]*\bdictionary\b/,
    gateNote: "passes the firm name dictionary to callGemini, which masks and gates every prompt",
  },
  {
    path: "src/lib/statutory/digest.ts",
    why: "Statutory digests of public portal text (class C).",
    gate: /callGemini\(/,
    gateNote: "callGemini masks and gates every prompt",
  },
  {
    path: "src/lib/auto-quiz.ts",
    why: "Quiz from a training video or a live-session transcript.",
    gate: /transcriptGate\(/,
    gateNote: "live recordings are never uploaded; transcripts pass transcriptGate or the session is parked",
  },
  {
    path: "src/lib/live/ingest.ts",
    why: "15-minute cron: Teams transcripts → auto-quiz.",
    gate: /transcriptGate\(/,
    gateNote: "transcripts masking cannot cover park the session for an admin before any Gemini call",
  },
  {
    path: "src/app/admin/video/[id]/page.tsx",
    why: "Admin pastes training notes for a video quiz.",
    gate: /generateQuiz\(/,
    gateNote: "generateQuiz masks and gates its own prompt",
  },
  {
    path: "src/app/api/admin/quiz/generate/route.ts",
    why: "Admin quiz generation API (same as the video page).",
    gate: /generateQuiz\(/,
    gateNote: "generateQuiz masks and gates its own prompt",
  },
];

const isTestFile = (p: string) => /\.test\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(tests|__tests__|__fixtures__)\//.test(p);
const AI_GUARD_FILES = new Set(["scripts/lib/guards.ts", "scripts/verify-ai-boundary.ts"]);

const scriptKind = (p: string) => (p.endsWith(".tsx") ? ts.ScriptKind.TSX : p.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(p) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/** `const x = <expr>` initialisers by name (first declaration wins), for constant folding. */
function constTable(sf: ts.SourceFile): Map<string, ts.Expression> {
  const m = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.getCombinedNodeFlags(n) & ts.NodeFlags.Const && !m.has(n.name.text)) m.set(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return m;
}

const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** The string an expression evaluates to when it is built only from constants; null otherwise. */
function fold(e: ts.Expression, consts: Map<string, ts.Expression>, depth = 0): string | null {
  if (depth > 16) return null;
  const f = (x: ts.Expression) => fold(x, consts, depth + 1);
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const sp of e.templateSpans) {
      const v = f(sp.expression);
      if (v === null) return null;
      s += v + sp.literal.text;
    }
    return s;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) return f(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = f(e.left);
    const b = f(e.right);
    return a === null || b === null ? null : a + b;
  }
  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text);
    return init ? f(init) : null;
  }
  if (ts.isCallExpression(e)) {
    const c = e.expression;
    const args = e.arguments.map((a) => f(a));
    if (ts.isPropertyAccessExpression(c)) {
      const name = c.name.text;
      if (name === "join" && ts.isArrayLiteralExpression(c.expression)) {
        const parts = c.expression.elements.map((x) => (ts.isSpreadElement(x) ? null : f(x)));
        const sep = e.arguments.length ? args[0] : ",";
        return parts.some((p) => p === null) || sep === null ? null : parts.join(sep);
      }
      if (name === "concat") {
        const base = f(c.expression);
        return base === null || args.some((a) => a === null) ? null : base + args.join("");
      }
      if (name === "fromCharCode" && ts.isIdentifier(c.expression) && c.expression.text === "String") {
        const codes = e.arguments.map((a) => (ts.isNumericLiteral(a) ? Number(a.text) : NaN));
        return codes.some((n) => Number.isNaN(n)) ? null : String.fromCharCode(...codes);
      }
      if (name === "toString" && ts.isCallExpression(c.expression)) {
        const inner = c.expression;
        if (ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "from" && ts.isIdentifier(inner.expression.expression) && inner.expression.expression.text === "Buffer") {
          const data = inner.arguments[0] ? f(inner.arguments[0]) : null;
          const enc = inner.arguments[1] ? f(inner.arguments[1]) : "utf8";
          return data === null ? null : enc === "base64" || enc === "base64url" ? b64(data) : data;
        }
      }
    }
    if (ts.isIdentifier(c) && c.text === "atob" && args[0] !== undefined && args[0] !== null) return b64(args[0]);
  }
  return null;
}

/** process.env names an expression reads (following consts). */
function envNamesIn(n: ts.Node, consts: Map<string, ts.Expression>, depth = 0): string[] {
  const out: string[] = [];
  const isProcessEnv = (x: ts.Expression) => ts.isPropertyAccessExpression(x) && x.name.text === "env" && ts.isIdentifier(x.expression) && x.expression.text === "process";
  const visit = (x: ts.Node) => {
    if (ts.isPropertyAccessExpression(x) && isProcessEnv(x.expression)) out.push(x.name.text);
    else if (ts.isElementAccessExpression(x) && isProcessEnv(x.expression) && ts.isStringLiteralLike(x.argumentExpression)) out.push(x.argumentExpression.text);
    else if (ts.isIdentifier(x) && depth < 4) {
      const init = consts.get(x.text);
      if (init) out.push(...envNamesIn(init, consts, depth + 1));
    }
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}

type ModuleRef = { spec: string; line: number; typeOnly: boolean };
type ParsedAi = { path: string; refs: ModuleRef[]; violations: Violation[] };

/** Module specifiers a file imports (static, re-export, dynamic import, require / createRequire), folded. */
function moduleRefs(sf: ts.SourceFile, consts: Map<string, ts.Expression>): ModuleRef[] {
  const out: ModuleRef[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isRequireLike = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) {
      if (callee.text === "require") return true;
      const init = consts.get(callee.text);
      return !!init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "createRequire";
    }
    return ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "createRequire";
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const clause = n.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((el) => el.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, line: lineOf(n), typeOnly });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, line: lineOf(n), typeOnly: n.isTypeOnly });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteralLike(n.moduleReference.expression)) {
      out.push({ spec: n.moduleReference.expression.text, line: lineOf(n), typeOnly: n.isTypeOnly });
    } else if (ts.isCallExpression(n) && n.arguments.length && (n.expression.kind === ts.SyntaxKind.ImportKeyword || isRequireLike(n.expression))) {
      const spec = fold(n.arguments[0], consts);
      if (spec !== null) out.push({ spec, line: lineOf(n), typeOnly: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const STRINGISH_CALLS = new Set(["join", "concat", "fromCharCode", "toString", "atob"]);
const BASE64_LITERAL = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;

/** The per-file AST rules: SDK imports, model hosts (folded), env-built model egress. */
function parseAiFile(f: SourceFile, legacy: Set<string>): ParsedAi {
  const p = norm(f.path);
  const sf = ts.createSourceFile(p, f.content, ts.ScriptTarget.Latest, true, scriptKind(p));
  const consts = constTable(sf);
  const violations: Violation[] = [];
  const lines = f.content.split(/\r?\n/);
  const add = (n: ts.Node | number, rule: string) => {
    const line = typeof n === "number" ? n : sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    violations.push({ path: p, line, rule, snippet: snip(lines[line - 1] ?? "") });
  };
  const refs = moduleRefs(sf, consts);
  for (const r of refs) if (isAiSdk(r.spec)) add(r.line, "ai-boundary:sdk-import");
  const isLegacy = legacy.has(p) && !isFirmOs(p);
  const testHosts = (n: ts.Node, text: string | null) => {
    if (!text) return;
    if (PROVIDER_HOST_ANY.test(text)) add(n, "ai-boundary:provider-host");
    if (!isLegacy && GEMINI_HOST_ANY.test(text)) add(n, "ai-boundary:gemini-rest");
  };
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n)) {
      testHosts(n, n.text);
      if (BASE64_LITERAL.test(n.text) && n.text.length % 4 !== 1) testHosts(n, b64(n.text));
    } else if (ts.isTemplateExpression(n)) {
      testHosts(n, [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("\u0000"));
      testHosts(n, fold(n, consts));
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      testHosts(n, fold(n, consts));
    } else if (ts.isCallExpression(n)) {
      const c = n.expression;
      const callee = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : "";
      if (STRINGISH_CALLS.has(callee)) testHosts(n, fold(n, consts));
      const isFetch = callee === "fetch" && (ts.isIdentifier(c) || ts.isPropertyAccessExpression(c));
      if (isFetch && !isLegacy) {
        const [url, init] = n.arguments;
        if (url) testHosts(url, fold(url, consts));
        if ((url && envNamesIn(url, consts).some((e) => AI_ENV_NAME.test(e))) || (init && envNamesIn(init, consts).some((e) => AI_KEY_ENV.test(e)))) add(n, "ai-boundary:egress-env");
      }
    } else if (ts.isIdentifier(n) && consts.has(n.text) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      // An identifier whose constant value is a model URL, used anywhere (e.g. passed to a wrapper).
      const init = consts.get(n.text) as ts.Expression;
      if (!ts.isStringLiteralLike(init)) testHosts(n, fold(n, consts));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { path: p, refs, violations };
}

/** Repo path an import specifier points at ("@/x" → src/x, relative paths), or null for a package. */
function resolveModule(from: string, spec: string, known: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    base = parts.join("/");
  }
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  for (const c of candidates) if (known.has(c)) return c;
  return /\.[cm]?[jt]sx?$/.test(base) ? base : `${base}.ts`; // best effort for files outside the scanned set
}

export function checkAiBoundary(files: SourceFile[], legacyGemini: string[] = LEGACY_GEMINI, callers: readonly LegacyAiCaller[] = LEGACY_GEMINI_CALLERS): Violation[] {
  const out: Violation[] = [];
  const legacy = new Set(legacyGemini.map(norm));
  const callerByPath = new Map(callers.map((c) => [norm(c.path), c]));
  const code = files.filter((f) => CODE_EXT.has(ext(norm(f.path))) && !norm(f.path).split("/").includes("node_modules"));
  const known = new Set(code.map((f) => norm(f.path)));
  const graph = new Map<string, string[]>();

  for (const f of code) {
    const p = norm(f.path);
    if (under(p, AI_PROVIDERS_DIR)) continue;
    // Line rules (unchanged; tests included).
    scanLines(f, "ai-boundary:sdk-import", AI_IMPORT_RE, out);
    scanLines(f, "ai-boundary:provider-host", AI_HOST_RE, out);
    if (!legacy.has(p) || isFirmOs(p)) scanLines(f, "ai-boundary:gemini-rest", GEMINI_REST_RE, out);
    if (isTestFile(p) || AI_GUARD_FILES.has(p)) continue;

    // AST rules.
    const parsed = parseAiFile(f, legacy);
    out.push(...parsed.violations);
    const targets: string[] = [];
    for (const r of parsed.refs) {
      const target = resolveModule(p, r.spec, known);
      if (!target || r.typeOnly) continue;
      targets.push(target);
      if (under(target, AI_PROVIDERS_DIR) && p !== AI_ROUTER) {
        out.push({ path: p, line: r.line, rule: "ai-boundary:provider-import", snippet: `imports ${r.spec} (model providers are reached through src/lib/ai/router.ts only)` });
      }
      if (legacy.has(target) && (isFirmOs(p) || (!legacy.has(p) && !callerByPath.has(p)))) {
        out.push({ path: p, line: r.line, rule: "ai-boundary:legacy-import", snippet: `imports ${r.spec}: a legacy Gemini egress module (allowed only for LEGACY_GEMINI_CALLERS, never Firm OS)` });
      }
    }
    graph.set(p, targets);
    const caller = callerByPath.get(p);
    if (caller && !caller.gate.test(f.content)) {
      out.push({ path: p, line: 1, rule: "ai-boundary:gate-missing", snippet: `allow-listed legacy Gemini caller no longer reaches the mask gate (${caller.gateNote})` });
    }
  }

  // Firm OS code must not reach legacy Gemini through any chain of imports.
  const reaches = new Map<string, boolean>();
  const reachesGemini = (p: string, stack: Set<string>): boolean => {
    if (legacy.has(p)) return true;
    const memo = reaches.get(p);
    if (memo !== undefined) return memo;
    if (stack.has(p)) return false;
    stack.add(p);
    const r = (graph.get(p) ?? []).some((t) => reachesGemini(t, stack));
    stack.delete(p);
    reaches.set(p, r);
    return r;
  };
  for (const p of graph.keys()) {
    if (!isFirmOs(p)) continue;
    const direct = (graph.get(p) ?? []).some((t) => legacy.has(t));
    if (!direct && reachesGemini(p, new Set())) out.push({ path: p, line: 1, rule: "ai-boundary:firm-os-reaches-gemini", snippet: "Firm OS code reaches a legacy Gemini egress module through its imports" });
  }

  // One violation per file, line and rule (the line and AST layers often see the same thing).
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = `${v.path}\u0000${v.line}\u0000${v.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function formatViolation(v: Violation): string {
  return `${v.path}:${v.line}  ${v.rule}  ${v.snippet}`;
}

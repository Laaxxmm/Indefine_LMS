// UI link checker (scripts/verify-ui-links.ts is the CLI). Pure functions: the caller passes the
// repo's files as { path, content }; nothing here reads the disk.
//
// 1. Route manifest from src/app: pages, route handlers (with the HTTP methods each exports),
//    dynamic [id] / catch-all [...slug] / optional [[...slug]] segments; route groups (x) and
//    parallel slots @x drop out of the URL; _private folders and intercepting (.)x routes are not
//    routes.
// 2. Every internal navigation target and client API call in src/**: JSX href (a, Link), href:
//    object props (nav item arrays), redirect / permanentRedirect, router.push / replace /
//    prefetch, redirectTo / callbackUrl, location assignments, <form action> with its method,
//    call() from src/components/ui.ts (POST unless the third argument says otherwise), fetch()
//    with its { method }, and any other "/api/..." literal (path checked, method unknown).
//    String and template literals are read with a small lexer that skips comments and regex
//    literals; a template's ${expr} is a wildcard segment, and ${NAME} is replaced by the value
//    of a `const NAME = "/..."` in the same file when there is exactly one.
// 3. Findings. Errors: a nav target with no page (or GET handler, or public file); an API call
//    with no route.ts, or whose method the route does not export; an "/api/..." literal with no
//    route; target="_blank" without rel noopener / noreferrer (noreferrer implies noopener).
//    Warning: a link to /admin/* outside src/app/admin in a file with no admin check in it.

export type SourceFile = { path: string; content: string };

// ------------------------------------------------------------------ route manifest

export type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "dynamic"; name: string }
  | { kind: "catchall"; name: string }
  | { kind: "optional-catchall"; name: string };

export type RouteEntry = {
  /** URL pattern, e.g. "/agents/[agent]/runs/[id]". */
  path: string;
  file: string;
  /** page = page.tsx; route = route.ts (methods below); static = metadata file served as is. */
  kind: "page" | "route" | "static";
  methods: string[];
  segments: RouteSegment[];
};

export type Manifest = { routes: RouteEntry[]; publicFiles: ReadonlySet<string> };

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
const PAGE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/;
const ROUTE_RE = /^route\.(tsx|ts|jsx|js)$/;
const METADATA_RE = /^(icon|apple-icon|favicon|opengraph-image|twitter-image|robots|sitemap|manifest)(\d*)?\.[a-z]+$/;
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** URL path and kind for a file under the app dir, or null when the file is not a route. */
export function routeFromFile(file: string, appDir = "src/app"): { path: string; kind: RouteEntry["kind"] } | null {
  const p = norm(file);
  const root = appDir.replace(/\/$/, "") + "/";
  if (!p.startsWith(root)) return null;
  const parts = p.slice(root.length).split("/");
  const base = parts.pop() ?? "";
  let kind: RouteEntry["kind"];
  if (PAGE_RE.test(base)) kind = "page";
  else if (ROUTE_RE.test(base)) kind = "route";
  else if (METADATA_RE.test(base)) kind = "static";
  else return null;
  const url: string[] = [];
  for (const seg of parts) {
    if (seg.startsWith("_")) return null; // private folder
    if (/^\(\.{1,3}\)/.test(seg) || seg.startsWith("(..)")) return null; // intercepting route
    if (/^\(.*\)$/.test(seg)) continue; // route group
    if (seg.startsWith("@")) continue; // parallel slot
    url.push(seg);
  }
  if (kind === "static") url.push(/\.(ts|tsx|js|jsx)$/.test(base) ? base.replace(/\.[a-z]+$/, "") : base);
  return { path: "/" + url.join("/"), kind };
}

export function parseSegments(path: string): RouteSegment[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((s): RouteSegment => {
      let m = s.match(/^\[\[\.\.\.(.+)\]\]$/);
      if (m) return { kind: "optional-catchall", name: m[1] };
      m = s.match(/^\[\.\.\.(.+)\]$/);
      if (m) return { kind: "catchall", name: m[1] };
      m = s.match(/^\[(.+)\]$/);
      if (m) return { kind: "dynamic", name: m[1] };
      return { kind: "static", value: s };
    });
}

/** HTTP methods a route.ts exports (functions, consts, destructured consts, export lists, re-exports). */
export function parseExportedMethods(content: string): string[] {
  const src = stripComments(content);
  const found = new Set<string>();
  const isMethod = (n: string) => (HTTP_METHODS as readonly string[]).includes(n);
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Z]+)\b/g)) if (isMethod(m[1])) found.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Z]+)\s*[:=]/g)) if (isMethod(m[1])) found.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop()?.trim() ?? "";
      if (isMethod(name)) found.add(name);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (isMethod(name)) found.add(name);
    }
  }
  return HTTP_METHODS.filter((m) => found.has(m));
}

export function buildManifest(files: SourceFile[], publicFiles: string[] = [], appDir = "src/app"): Manifest {
  const routes: RouteEntry[] = [];
  for (const f of files) {
    const r = routeFromFile(f.path, appDir);
    if (!r) continue;
    routes.push({ ...r, file: norm(f.path), methods: r.kind === "route" ? parseExportedMethods(f.content) : [], segments: parseSegments(r.path) });
  }
  const pub = new Set(publicFiles.map((p) => "/" + norm(p).replace(/^public\//, "")));
  return { routes, publicFiles: pub };
}

// ------------------------------------------------------------------ lexer

/** A string or template literal. `parts` are the text between ${…}; `exprs` the expression sources. */
export type Literal = { start: number; end: number; quote: '"' | "'" | "`"; parts: string[]; exprs: string[] };

const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|void|throw|yield|await)$/;

function prevSignificant(src: string, i: number): { ch: string; at: number } {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return { ch: j >= 0 ? src[j] : "", at: j };
}

function looksLikeRegexStart(src: string, i: number): boolean {
  const { ch, at } = prevSignificant(src, i);
  if (ch === "") return true;
  if (ch === ">") return src[at - 1] === "="; // arrow body; JSX "</" and "/>" are not regexes
  if (REGEX_PREV.has(ch)) {
    // "}" ends a block (regex may follow) or an object/JSX expression (division / text): only after a newline.
    if (ch === "}") return /\n\s*$/.test(src.slice(at + 1, i));
    return true;
  }
  return REGEX_KEYWORDS.test(src.slice(Math.max(0, at - 10), at + 1));
}

/** Index after a regex literal starting at i, or -1 when it is not one (no closing slash on the line). */
function skipRegex(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") inClass = true;
    else if (c === "/") {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/** Index after a quoted string starting at i, or -1 when it runs into a newline (an apostrophe in JSX text). */
function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    if (c === "\n") return -1;
    j++;
  }
  return -1;
}

/** Reads a template literal at i: its parts, expression sources and end. Nested literals in ${…} are skipped. */
function readTemplate(src: string, i: number, out?: Literal[]): { end: number; parts: string[]; exprs: string[] } {
  const parts: string[] = [];
  const exprs: string[] = [];
  let cur = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      cur += src.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (c === "`") {
      parts.push(cur);
      return { end: j + 1, parts, exprs };
    }
    if (c === "$" && src[j + 1] === "{") {
      parts.push(cur);
      cur = "";
      const exprStart = j + 2;
      const exprEnd = skipBalanced(src, exprStart, "}", out);
      exprs.push(src.slice(exprStart, exprEnd));
      j = exprEnd + 1;
      continue;
    }
    cur += c;
    j++;
  }
  parts.push(cur);
  return { end: src.length, parts, exprs };
}

/** Index of the closing `close` for an opening just before `i`, skipping strings, templates and comments. */
function skipBalanced(src: string, i: number, close: "}" | ")" | "]", out?: Literal[]): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [close];
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === "/" && src[j + 1] === "/") {
      const nl = src.indexOf("\n", j);
      j = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[j + 1] === "*") {
      const e = src.indexOf("*/", j + 2);
      j = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const e = skipQuoted(src, j);
      if (e > 0) {
        out?.push({ start: j, end: e, quote: c, parts: [unescape(src.slice(j + 1, e - 1))], exprs: [] });
        j = e;
        continue;
      }
    } else if (c === "`") {
      const t = readTemplate(src, j, out);
      out?.push({ start: j, end: t.end, quote: "`", parts: t.parts, exprs: t.exprs });
      j = t.end;
      continue;
    } else if (c === "/" && looksLikeRegexStart(src, j)) {
      const e = skipRegex(src, j);
      if (e > 0) {
        j = e;
        continue;
      }
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return j;
    }
    j++;
  }
  return src.length;
}

const unescape = (s: string) => s.replace(/\\(["'\\/`])/g, "$1");

/** Every string and template literal in the source, in order, outside comments and regex literals. */
export function scanLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const e = skipQuoted(src, i);
      if (e < 0) {
        i++;
        continue;
      }
      out.push({ start: i, end: e, quote: c, parts: [unescape(src.slice(i + 1, e - 1))], exprs: [] });
      i = e;
      continue;
    }
    if (c === "`") {
      const nested: Literal[] = [];
      const t = readTemplate(src, i, nested);
      out.push({ start: i, end: t.end, quote: "`", parts: t.parts, exprs: t.exprs });
      out.push(...nested);
      i = t.end;
      continue;
    }
    if (c === "/" && looksLikeRegexStart(src, i)) {
      const e = skipRegex(src, i);
      if (e > 0) {
        i = e;
        continue;
      }
    }
    i++;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Source with comments removed (strings kept), for the export parser. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const e = c === "`" ? readTemplate(src, i).end : skipQuoted(src, i);
      if (e > 0) {
        out += src.slice(i, e);
        i = e;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// ------------------------------------------------------------------ targets

/** Stands for a ${…} in a path pattern. */
export const WILD = "\u0001";

export type TargetKind = "nav" | "api-call" | "form" | "api-ref";
export type Target = {
  file: string;
  line: number;
  kind: TargetKind;
  /** How it was found: "href", "href:", "redirect", "router.push", "call", "fetch", "form action", … */
  via: string;
  /** The literal as written (trimmed). */
  raw: string;
  /** Path pattern ("/agents/\u0001"), query and hash removed; null when it could not be resolved to a path. */
  pattern: string | null;
  /** HTTP method for api-call / form / nav-to-API; null when it is not a literal. */
  method: string | null;
  external: boolean;
};

const lineAt = (src: string, i: number) => src.slice(0, i).split("\n").length;
const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Splits the source of a call's arguments that starts at `i` (just after the first argument). */
function restArgs(src: string, i: number): string[] {
  const end = skipBalanced(src, i, ")");
  const body = src.slice(i, end);
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '"' || c === "'" || c === "`") {
      const e = c === "`" ? readTemplate(body, j).end : skipQuoted(body, j);
      if (e > 0) {
        cur += body.slice(j, e);
        j = e - 1;
        continue;
      }
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  // body starts right after the first argument, so args[0] is "" (the text before the first comma).
  return args.slice(1).filter((a) => a !== "");
}

const literalText = (arg: string): string | null => {
  const m = arg.match(/^(["'`])([^"'`$]*)\1$/);
  return m ? m[2] : null;
};

/** The JSX opening tag that contains position i, if any: its name and full source. */
export function enclosingTag(src: string, i: number): { name: string; text: string } | null {
  let lt = src.lastIndexOf("<", i);
  while (lt >= 0) {
    const m = src.slice(lt + 1, lt + 40).match(/^([A-Za-z][\w.]*)/);
    if (m) {
      const end = tagEnd(src, lt);
      if (end > i) return { name: m[1], text: src.slice(lt, end) };
      return null;
    }
    lt = src.lastIndexOf("<", lt - 1);
  }
  return null;
}

/** Index after the ">" closing the opening tag at lt (braces and strings skipped). */
function tagEnd(src: string, lt: number): number {
  let j = lt + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "{") {
      j = skipBalanced(src, j + 1, "}") + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const e = skipQuoted(src, j);
      if (e > 0) {
        j = e;
        continue;
      }
    }
    if (c === ">") return j + 1;
    j++;
  }
  return src.length;
}

/** Literal value of a JSX attribute in a tag's source: name="x", name='x' or name={"x"}. */
export function attrValue(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}
const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}(?=[\\s=/>])`).test(tag);

type Context = { kind: TargetKind; via: string } | null;

function contextOf(before: string, value: string, usesUiCall: boolean): Context {
  const b = before.replace(/\s+$/, "");
  if (/\bhref\s*=\s*\{?$/.test(b) || /\bhref\s*=\s*\{[^{}]*[?:]$/.test(b)) return { kind: "nav", via: "href" };
  if (/\bhref\s*:$/.test(b) || /\bhref\s*:[^,{};\n]*[?:]$/.test(b)) return { kind: "nav", via: "href:" };
  if (/\b(?:redirect|permanentRedirect)\s*\($/.test(b)) return { kind: "nav", via: "redirect" };
  if (/\.(?:push|replace|prefetch)\s*\($/.test(b)) return { kind: "nav", via: "router" };
  if (/\b(?:redirectTo|callbackUrl)\s*:$/.test(b)) return { kind: "nav", via: "redirectTo" };
  if (/\blocation(?:\.href)?\s*=$/.test(b) || /\blocation\.(?:assign|replace)\s*\($/.test(b)) return { kind: "nav", via: "location" };
  if (/\baction\s*=\s*\{?$/.test(b)) return { kind: "form", via: "form action" };
  if (usesUiCall && /(?<![\w$.])call\s*\($/.test(b)) return { kind: "api-call", via: "call" };
  if (/(?<![\w$.])fetch\s*\($/.test(b)) return { kind: "api-call", via: "fetch" };
  if (value.startsWith("/api/")) return { kind: "api-ref", via: "literal" };
  return null;
}

/** `const NAME = "/…"` (or a template starting with "/") in the file → its pattern; ambiguous names dropped. */
const CONST_INIT = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$<>[\]|. ]+)?=\s*$/;

function constPatterns(src: string, lits: Literal[]): Map<string, string> {
  const map = new Map<string, string | null>();
  for (const l of lits) {
    const m = src.slice(Math.max(0, l.start - 120), l.start).match(CONST_INIT);
    // "/…" paths, and absolute URLs so that `${GRAPH}/me` reads as external.
    if (!m || !(l.parts[0].startsWith("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(l.parts[0]))) continue;
    const p = l.parts.join(WILD);
    map.set(m[1], map.has(m[1]) && map.get(m[1]) !== p ? null : p);
  }
  return new Map([...map].filter((e): e is [string, string] => e[1] !== null));
}

/** Path pattern for a literal, with known consts substituted; null if it does not resolve to "/…". */
function patternOf(l: Literal, consts: Map<string, string>): { pattern: string | null; raw: string; external: boolean } {
  let s = l.parts[0];
  for (let k = 0; k < l.exprs.length; k++) {
    const e = l.exprs[k].trim();
    s += (IDENT.test(e) && consts.has(e) ? consts.get(e)! : WILD) + l.parts[k + 1];
  }
  const raw = l.quote === "`" ? "`" + l.parts.map((p, k) => (k ? "${" + l.exprs[k - 1] + "}" : "") + p).join("") + "`" : l.parts[0];
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) return { pattern: null, raw, external: true };
  if (!s.startsWith("/")) return { pattern: null, raw, external: false };
  const cut = s.search(/[?#]/);
  return { pattern: cut >= 0 ? s.slice(0, cut) || "/" : s, raw, external: false };
}

const PATHLIKE = /^\/(?:[A-Za-z0-9_\-.~%[\]\u0001]|$)/;

/** Every navigation target and API call in one source file. */
export function extractTargets(file: SourceFile): Target[] {
  const src = file.content;
  const path = norm(file.path);
  const lits = scanLiterals(src);
  const consts = constPatterns(src, lits);
  // Only src/components/ui.ts call(url, body?, method = "POST"); a file's own call() is read as a plain /api literal.
  const usesUiCall = /import\s*\{[^}]*\bcall\b[^}]*\}\s*from\s*["']@\/components\/ui["']/.test(src);
  const out: Target[] = [];
  for (const l of lits) {
    const before = src.slice(Math.max(0, l.start - 160), l.start);
    const { pattern, raw, external } = patternOf(l, consts);
    const ctx = contextOf(before, pattern ?? l.parts[0], usesUiCall);
    if (!ctx) continue;
    if (/^[#?]/.test(l.parts[0])) continue; // in-page anchor, or a query on the current page
    if (pattern !== null && !PATHLIKE.test(pattern)) continue;
    if (ctx.kind === "api-ref" && !pattern?.startsWith("/api/")) continue;
    // const API = "/api/x": a prefix, checked where it is used (${API}/y), not as a route of its own.
    if (ctx.kind === "api-ref" && CONST_INIT.test(before)) continue;
    if (ctx.via === "router") {
      if (!pattern) continue;
      // "abc".replace("/", "-") and arr.push("/x") are not navigation: a router call's second
      // argument, when there is one, is an options object.
      const second = restArgs(src, l.end)[0];
      if (second !== undefined && !second.startsWith("{")) continue;
    }
    let method: string | null = null;
    let via = ctx.via;
    if (ctx.kind === "nav") {
      const tag = ctx.via === "href" ? enclosingTag(src, l.start) : null;
      if (tag) via = tag.name === "Link" ? "Link href" : `<${tag.name}> href`;
      method = "GET";
    } else if (ctx.kind === "form") {
      const tag = enclosingTag(src, l.start);
      if (!tag || tag.name !== "form") continue;
      method = (attrValue(tag.text, "method") ?? "GET").toUpperCase();
    } else if (ctx.kind === "api-call") {
      const args = restArgs(src, l.end);
      if (ctx.via === "call") {
        const m = args[1];
        method = m === undefined ? "POST" : literalText(m)?.toUpperCase() ?? null;
      } else {
        const opts = args[0];
        if (opts === undefined) method = "GET";
        else if (opts.startsWith("{")) {
          const mm = opts.match(/\bmethod\s*:\s*(["'`])(\w+)\1/);
          method = mm ? mm[2].toUpperCase() : /\bmethod\b/.test(opts) ? null : "GET";
        } else method = null;
      }
    }
    out.push({ file: path, line: lineAt(src, l.start), kind: ctx.kind, via, raw, pattern, method, external });
  }
  return out;
}

// ------------------------------------------------------------------ matching

type PatSeg = { kind: "lit"; value: string } | { kind: "any" } | { kind: "partial"; re: RegExp };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function splitPattern(pattern: string): PatSeg[] {
  return pattern
    .split("/")
    .filter((s, i, a) => s !== "" || (i > 0 && i < a.length - 1))
    .map((s): PatSeg => {
      if (s === WILD) return { kind: "any" };
      if (s.includes(WILD)) return { kind: "partial", re: new RegExp("^" + s.split(WILD).map(escapeRe).join(".*") + "$") };
      let value = s;
      try {
        value = decodeURIComponent(s);
      } catch {
        /* keep as written */
      }
      return { kind: "lit", value };
    });
}

function matchFrom(route: RouteSegment[], i: number, pat: PatSeg[], j: number): boolean {
  if (i === route.length) return j === pat.length;
  const r = route[i];
  if (r.kind === "catchall" || r.kind === "optional-catchall") {
    for (let k = r.kind === "catchall" ? j + 1 : j; k <= pat.length; k++) if (matchFrom(route, i + 1, pat, k)) return true;
    return false;
  }
  if (j === pat.length) return false;
  const p = pat[j];
  if (r.kind === "static") {
    const ok = p.kind === "any" || (p.kind === "lit" && p.value === r.value) || (p.kind === "partial" && p.re.test(r.value));
    return ok && matchFrom(route, i + 1, pat, j + 1);
  }
  return matchFrom(route, i + 1, pat, j + 1);
}

export function routesMatching(manifest: Manifest, pattern: string): RouteEntry[] {
  const pat = splitPattern(pattern);
  return manifest.routes.filter((r) => matchFrom(r.segments, 0, pat, 0));
}

// ------------------------------------------------------------------ findings

export type Finding = { level: "error" | "warn"; rule: string; file: string; line: number; target: string; message: string };
export type CheckResult = {
  findings: Finding[];
  targets: Target[];
  stats: { files: number; pages: number; handlers: number; checked: number; unresolved: number; byKind: Record<TargetKind, number> };
};

const ADMIN_GATE = /\b(?:isAdmin|isClientsAdmin|isSopAdmin|isNeoCentraAdmin)\b|\badmin\s*(?:&&|\?)|role\s*===?\s*["']ADMIN["']/;
const SCAN_EXT = /\.(tsx|ts|jsx|js)$/;
const SKIP_FILE = /(?:\.test\.|\.spec\.|\.d\.ts$|\/__fixtures__\/|\/__tests__\/)/;
const show = (t: Target) => (t.pattern ?? t.raw).replace(new RegExp(WILD, "g"), "${…}");

/** Files the checker reads for targets: source under srcDir, tests and fixtures excluded. */
export const isScanned = (p: string, srcDir = "src") => {
  const n = norm(p);
  return n.startsWith(srcDir.replace(/\/$/, "") + "/") && SCAN_EXT.test(n) && !SKIP_FILE.test(n);
};

/** target="_blank" links (a, Link) whose rel has neither noopener nor noreferrer. */
export function blankTargetIssues(file: SourceFile): Finding[] {
  const src = file.content;
  const out: Finding[] = [];
  for (const m of src.matchAll(/<(a|Link)(?=[\s>])/g)) {
    const text = src.slice(m.index!, tagEnd(src, m.index!));
    if (attrValue(text, "target") !== "_blank") continue;
    const rel = attrValue(text, "rel");
    if (rel !== null && /\b(noopener|noreferrer)\b/.test(rel)) continue;
    if (rel === null && hasAttr(text, "rel")) continue; // rel={expr}: cannot read it, do not guess
    out.push({ level: "error", rule: "link:blank-no-noopener", file: norm(file.path), line: lineAt(src, m.index!), target: attrValue(text, "href") ?? "(dynamic href)", message: 'target="_blank" without rel="noopener noreferrer"' });
  }
  return out;
}

export function checkUiLinks(files: SourceFile[], opts: { publicFiles?: string[]; appDir?: string; srcDir?: string } = {}): CheckResult {
  const appDir = opts.appDir ?? "src/app";
  const manifest = buildManifest(files, opts.publicFiles ?? [], appDir);
  const findings: Finding[] = [];
  const targets: Target[] = [];
  const byKind: Record<TargetKind, number> = { nav: 0, "api-call": 0, form: 0, "api-ref": 0 };
  let unresolved = 0;
  let checked = 0;
  const scanned = files.filter((f) => isScanned(f.path, opts.srcDir));

  for (const f of scanned) {
    findings.push(...blankTargetIssues(f));
    for (const t of extractTargets(f)) {
      targets.push(t);
      if (t.external) continue;
      if (!t.pattern) {
        unresolved++;
        continue;
      }
      checked++;
      byKind[t.kind]++;
      const at = { file: t.file, line: t.line, target: show(t) };
      const isApi = t.pattern.startsWith("/api/") || t.pattern === "/api";
      const hits = routesMatching(manifest, t.pattern);
      if (t.kind === "nav" && !isApi) {
        const ok = hits.some((r) => r.kind === "page" || r.kind === "static" || (r.kind === "route" && r.methods.includes("GET"))) || manifest.publicFiles.has(t.pattern);
        if (!ok) findings.push({ level: "error", rule: "nav:no-page", ...at, message: `${t.via} points at a page that does not exist` });
        if (t.pattern.split("/")[1] === "admin" && !norm(f.path).startsWith(appDir + "/admin/") && !ADMIN_GATE.test(f.content)) {
          findings.push({ level: "warn", rule: "nav:admin-ungated", ...at, message: "link to the admin area in a file with no admin check; non-admins are redirected away" });
        }
        continue;
      }
      const handlers = hits.filter((r) => r.kind === "route");
      if (handlers.length === 0) {
        const rule = t.kind === "nav" ? "nav:api-no-route" : t.kind === "api-ref" ? "api-ref:no-route" : "api:no-route";
        findings.push({ level: "error", rule, ...at, message: `${t.via} points at an API route that does not exist` });
        continue;
      }
      if (t.kind === "api-ref" || t.method === null) continue;
      const method = t.method === "HEAD" ? "GET" : t.method;
      if (!handlers.some((r) => r.methods.includes(method))) {
        const exported = [...new Set(handlers.flatMap((r) => r.methods))].join(", ") || "nothing";
        findings.push({ level: "error", rule: "api:method-not-exported", ...at, message: `${t.via} sends ${t.method}, the route exports ${exported} (${handlers.map((r) => r.file).join(", ")})` });
      }
    }
  }
  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    findings,
    targets,
    stats: { files: scanned.length, pages: manifest.routes.filter((r) => r.kind === "page").length, handlers: manifest.routes.filter((r) => r.kind === "route").length, checked, unresolved, byKind },
  };
}

export const formatFinding = (f: Finding) => `${f.file}:${f.line}  ${f.level === "error" ? "error" : "warn "} ${f.rule}  ${f.target} — ${f.message}`;

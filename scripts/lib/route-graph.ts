// Static call graph of Firm OS route handlers, for scripts/verify-rbac.ts and
// scripts/verify-audit-coverage.ts. Built on the TypeScript compiler API, so a call is resolved the
// way the compiler resolves it: through imports, re-exports (barrels), aliases, class and object
// methods and `this.x()`; not by matching names. Only declarations under src/ are followed
// (node_modules and .d.ts files are leaves).
//
// What it cannot see: functions passed in as values and called through an interface-typed
// parameter (e.g. `deps.afterTransition(t)`, `deps.audit(e)`): the declaration found is the
// interface member, which has no body. Such a call is still recorded as a call site by name, so a
// checker can match it (verify-audit-coverage treats a call named `audit` as a legacy audit sink).
//
// Discovery is automatic: every route.ts under a Firm OS directory (scripts/lib/guards.ts
// FIRM_OS_DIRS) is a route; nothing has to be registered for a new route to be checked.
import ts from "typescript";
import { isAbsolute, join } from "node:path";
import { isFirmOs } from "./guards";
import { HTTP_METHODS, routeFromFile } from "./ui-links";

export type Fn = {
  /** `<repo-relative file>#<name>@<offset>`; unique per function. */
  id: string;
  /** Repo-relative path with forward slashes. */
  file: string;
  /** Function name as written (`Class.method` / `object.method` for members). */
  name: string;
  node: ts.FunctionLikeDeclaration;
};

export type CallSite = {
  /** Last identifier of the callee: `logAudit`, `create` (for `tx.auditEvent.create`), `auth`. */
  name: string;
  /** Callee expression as written, whitespace collapsed (`tx.auditEvent.create`). */
  text: string;
  /** Receiver chain of a member call (`tx.auditEvent` for `tx.auditEvent.create(...)`); null otherwise. */
  receiver: string | null;
  /** Bodies the compiler resolved the callee to (under src/ only). */
  targets: Fn[];
  /** Repo-relative files declaring the callee symbol, bodies or not (e.g. src/lib/auth.ts for `auth`). */
  declFiles: string[];
  /** 1-based line in the caller's file. */
  line: number;
};

export type Handler = { method: string; route: string; file: string; fn: Fn };

const norm = (p: string) => p.replace(/\\/g, "/");

// ------------------------------------------------------------------ programs

/** A program over the real repo (tsconfig.json compiler options), rooted at the given files. */
export function createRepoProgram(root: string, rootFiles: string[]): ts.Program {
  const configPath = join(root, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, root);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, skipLibCheck: true };
  return ts.createProgram({ rootNames: rootFiles.map((f) => (isAbsolute(f) ? f : join(root, f))), options });
}

/**
 * A program over in-memory files (tests). Paths are repo-relative ("src/app/api/x/route.ts");
 * `@/` resolves to `src/` as in tsconfig. No lib files: symbol resolution needs none.
 */
export function createMemoryProgram(files: Record<string, string>): { program: ts.Program; root: string } {
  const root = "/repo";
  const abs = (p: string) => (p.startsWith(root + "/") ? p : `${root}/${norm(p).replace(/^\.?\//, "")}`);
  const map = new Map(Object.entries(files).map(([p, c]) => [abs(p), c]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noEmit: true,
    types: [],
    baseUrl: root,
    paths: { "@/*": ["src/*"] },
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name, lang) => {
      const text = map.get(norm(name));
      return text === undefined ? undefined : ts.createSourceFile(name, text, lang, true);
    },
    getDefaultLibFileName: () => `${root}/lib.d.ts`,
    writeFile: () => {},
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    fileExists: (name) => map.has(norm(name)),
    readFile: (name) => map.get(norm(name)),
    getCanonicalFileName: (name) => norm(name),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    directoryExists: (dir) => [...map.keys()].some((k) => k.startsWith(norm(dir).replace(/\/?$/, "/"))),
  };
  return { program: ts.createProgram({ rootNames: [...map.keys()], options, host }), root };
}

// ------------------------------------------------------------------ discovery

/** Repo-relative route.ts files under the Firm OS directories. */
export function discoverFirmOsRoutes(paths: string[]): string[] {
  return paths
    .map(norm)
    .filter((p) => p.startsWith("src/app/") && isFirmOs(p) && /\/route\.(ts|tsx)$/.test(p))
    .sort();
}

/** URL pattern of a route file ("/api/firm-os/jobs/[id]/state"). */
export function routePath(file: string): string {
  return routeFromFile(file)?.path ?? file;
}

// ------------------------------------------------------------------ graph

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};

const isFnExpr = (e: ts.Node): e is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(e) || ts.isFunctionExpression(e);

export class CallGraph {
  readonly checker: ts.TypeChecker;
  private fns = new Map<ts.Node, Fn>();
  private calls = new Map<string, CallSite[]>();

  constructor(
    readonly program: ts.Program,
    readonly root: string,
  ) {
    this.checker = program.getTypeChecker();
  }

  rel(fileName: string): string {
    const f = norm(fileName);
    const r = norm(this.root).replace(/\/$/, "");
    return f.toLowerCase().startsWith(r.toLowerCase() + "/") ? f.slice(r.length + 1) : f;
  }

  private inScope(sf: ts.SourceFile): boolean {
    const p = this.rel(sf.fileName);
    return !sf.isDeclarationFile && p.startsWith("src/") && !p.includes("/node_modules/");
  }

  sourceFile(file: string): ts.SourceFile | undefined {
    const want = norm(file).toLowerCase();
    return this.program.getSourceFiles().find((sf) => this.rel(sf.fileName).toLowerCase() === want);
  }

  /** The function-like body behind a declaration, or null (interface members, values, externals). */
  fnOf(decl: ts.Node): Fn | null {
    const sf = decl.getSourceFile();
    if (!this.inScope(sf)) return null;
    let node: ts.FunctionLikeDeclaration | undefined;
    let name = "";
    if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isConstructorDeclaration(decl) || ts.isGetAccessorDeclaration(decl) || isFnExpr(decl)) {
      node = decl;
      name = decl.name && !ts.isComputedPropertyName(decl.name) ? decl.name.getText(sf) : ts.isConstructorDeclaration(decl) ? "constructor" : "(anonymous)";
      const owner = decl.parent;
      if ((ts.isMethodDeclaration(decl) || ts.isConstructorDeclaration(decl) || ts.isGetAccessorDeclaration(decl)) && owner) {
        const ownerName = ts.isClassLike(owner) && owner.name ? owner.name.text : ts.isObjectLiteralExpression(owner) ? "object" : "";
        if (ownerName) name = `${ownerName}.${name}`;
      }
    } else if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isPropertyDeclaration(decl)) && decl.initializer) {
      const init = unwrap(decl.initializer);
      if (isFnExpr(init)) {
        node = init;
        name = decl.name.getText(sf);
      }
    } else if (ts.isShorthandPropertyAssignment(decl)) {
      const value = this.checker.getShorthandAssignmentValueSymbol(decl);
      for (const d of this.resolveAlias(value)?.declarations ?? []) {
        const f = this.fnOf(d);
        if (f) return f;
      }
      return null;
    }
    if (!node || !node.body) return null;
    const hit = this.fns.get(node);
    if (hit) return hit;
    const file = this.rel(sf.fileName);
    const fn: Fn = { id: `${file}#${name}@${node.getStart(sf)}`, file, name, node };
    this.fns.set(node, fn);
    return fn;
  }

  private resolveAlias(sym: ts.Symbol | undefined): ts.Symbol | undefined {
    if (sym && sym.flags & ts.SymbolFlags.Alias) return this.checker.getAliasedSymbol(sym);
    return sym;
  }

  private symbolOf(callee: ts.Expression): ts.Symbol | undefined {
    const e = unwrap(callee);
    const at = ts.isPropertyAccessExpression(e) ? e.name : ts.isElementAccessExpression(e) ? e.argumentExpression : e;
    return this.resolveAlias(this.checker.getSymbolAtLocation(at));
  }

  /** Bodies a callee expression resolves to. */
  targetsOf(callee: ts.Expression): Fn[] {
    const out: Fn[] = [];
    for (const d of this.symbolOf(callee)?.declarations ?? []) {
      const f = this.fnOf(d);
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  }

  /** Files declaring the callee symbol (any declaration kind). */
  declFilesOf(callee: ts.Expression): string[] {
    return [...new Set((this.symbolOf(callee)?.declarations ?? []).map((d) => this.rel(d.getSourceFile().fileName)))];
  }

  /**
   * Every call (and `new`) the function makes when it runs: its own body plus callbacks it passes
   * to a call (`$transaction(async (tx) => …)`, `.map((x) => …)`) and IIFEs. Functions it merely
   * defines — object-literal methods, nested `const f = () => …`, returned closures, classes — are
   * separate nodes, reached only if something calls them (a factory that builds a repository
   * object does not "write" by being called).
   */
  callsOf(fn: Fn): CallSite[] {
    const cached = this.calls.get(fn.id);
    if (cached) return cached;
    const sf = fn.node.getSourceFile();
    const out: CallSite[] = [];
    const runsInline = (f: ts.Node) => {
      const p = f.parent;
      if (!p) return false;
      if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
        const args: readonly ts.Node[] = p.arguments ?? [];
        if (args.includes(f)) return true;
      }
      // (async () => { … })()
      let up: ts.Node = f;
      while (up.parent && ts.isParenthesizedExpression(up.parent)) up = up.parent;
      return !!up.parent && ts.isCallExpression(up.parent) && up.parent.expression === up;
    };
    const visit = (n: ts.Node) => {
      if (n !== fn.node.body && (ts.isClassLike(n) || (ts.isFunctionLike(n) && !runsInline(n)))) return;
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.expression) {
        const callee = unwrap(n.expression);
        const text = callee.getText(sf).replace(/\s+/g, "");
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : text;
        const receiver = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression).getText(sf).replace(/\s+/g, "") : null;
        out.push({ name, text, receiver, targets: this.targetsOf(callee), declFiles: this.declFilesOf(callee), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
      }
      ts.forEachChild(n, visit);
    };
    if (fn.node.body) visit(fn.node.body);
    this.calls.set(fn.id, out);
    return out;
  }

  private exportsCache = new Map<string, Set<ts.Node>>();

  /** Whether the function is part of its module's exports (directly, or via `export { x }`). */
  isExported(fn: Fn): boolean {
    let set = this.exportsCache.get(fn.file);
    if (!set) {
      set = new Set<ts.Node>();
      const sf = fn.node.getSourceFile();
      const mod = this.checker.getSymbolAtLocation(sf);
      for (const sym of mod ? this.checker.getExportsOfModule(mod) : []) {
        for (const d of this.resolveAlias(sym)?.declarations ?? []) {
          const f = this.fnOf(d);
          if (f) set.add(f.node);
        }
      }
      this.exportsCache.set(fn.file, set);
    }
    return set.has(fn.node);
  }

  /** Exported HTTP method handlers of a route file. */
  handlers(file: string): Handler[] {
    const sf = this.sourceFile(file);
    if (!sf) return [];
    const route = routePath(this.rel(sf.fileName));
    const out: Handler[] = [];
    const methods = new Set<string>(HTTP_METHODS);
    const exported = (s: ts.Statement) => ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const s of sf.statements) {
      if (!exported(s)) continue;
      if (ts.isFunctionDeclaration(s) && s.name && methods.has(s.name.text)) {
        const fn = this.fnOf(s);
        if (fn) out.push({ method: s.name.text, route, file: this.rel(sf.fileName), fn });
      } else if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !methods.has(d.name.text)) continue;
          const fn = this.fnOf(d);
          if (fn) out.push({ method: d.name.text, route, file: this.rel(sf.fileName), fn });
        }
      }
    }
    return out;
  }

  /** Functions reachable from `start` (start included), breadth first, up to `maxDepth` calls deep. */
  reachable(start: Fn, maxDepth = 12): Fn[] {
    const seen = new Map<string, Fn>([[start.id, start]]);
    let frontier = [start];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: Fn[] = [];
      for (const f of frontier) {
        for (const c of this.callsOf(f)) {
          for (const t of c.targets) {
            if (seen.has(t.id)) continue;
            seen.set(t.id, t);
            next.push(t);
          }
        }
      }
      frontier = next;
    }
    return [...seen.values()];
  }
}

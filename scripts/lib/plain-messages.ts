// Repo scan for the plain-language rule: every message a person can see is a sentence that says
// what went wrong and what to do, with no codes (src/lib/errors/rules.ts holds the patterns).
//
// The scan reads TypeScript / JavaScript with the compiler's parser and picks out the string
// literals that reach a person:
//   - `error:` / `reason:` / `message:` / `notice:` / `skipped:` / `required_error:` /
//     `invalid_type_error:` values (route JSON, service results, zod error maps)
//   - sentence arguments of failure helpers (`fail(409, "…")`, `deny("FORBIDDEN", "…")`), of zod
//     checks (`.min(1, "…")`, `.refine(fn, "…")`) and of UI setters (`setError("…")`)
//   - sentence arguments of `new <Something>Error(…)` for the error classes whose message is shown
//   - every string inside a message table: a const named like MSG / TEXT / *_MESSAGE / *_ACTION,
//     or returned by a function named like *Message / *Sentence / *Notice
// and flags raw exception text passed to a person: `(e as Error).message`, `String(e)`, `.stack`.
// Plain `new Error("…")` is not scanned: those messages never reach the UI (routes answer with
// userMessage(e, …) from src/lib/errors, which only passes PlainError and the classes below).
import ts from "typescript";
import { PLAIN_ERROR_NAMES } from "../../src/lib/errors";
import { messageProblems } from "../../src/lib/errors/rules";
import type { SourceFile, Violation } from "./guards";

/** Error classes whose message is shown to a person: scanned at every `new X(…)`. BlockedError carries the action to take. */
export const USER_FACING_ERRORS: readonly string[] = [...PLAIN_ERROR_NAMES, "BlockedError", "TuriaBlockedError"];

const MESSAGE_KEYS = new Set(["error", "reason", "message", "notice", "skipped", "required_error", "invalid_type_error", "hint", "userMessage"]);
const FAIL_FNS = /^(?:fail|deny|refuse|bad|badRequest|forbidden|notFound|conflict|problem|failure|refused|invalid|blocked|gone|busy|tooMany|oops|userError|plain)$/;
const ZOD_FNS = new Set(["min", "max", "length", "regex", "email", "url", "uuid", "int", "positive", "nonnegative", "negative", "nonpositive", "nonempty", "refine", "startsWith", "endsWith", "gte", "lte", "gt", "lt", "multipleOf", "finite", "datetime", "date", "time", "ip", "cuid"]);
const SETTERS = /^(?:set\w*(?:Error|Errors|Err|Msg|Message|Notice|Warning|Problem|Flash|Toast|Feedback|Banner)|toast|report|notice|showError|showNotice|back|flash)$/;
const TABLE_NAME = /^(?:MSG|MSGS|TEXT|TEXTS|COPY|NOTICES?|MESSAGES?|ERRORS?|REFUSED|REFUSALS?|[A-Z][A-Z0-9_]*_(?:MESSAGES?|MSG|NOTICES?|SENTENCES?|ERRORS?|ACTIONS?|REFUSALS?|HINTS?|REASONS?))$/;
const FN_NAME = /(?:Message|Sentence|Notice|Refusal|Reason|Copy)$/;
const RAW_EXCEPTION = /\(\s*\w+\s+as\s+Error\s*\)\s*\.\s*message|\bString\(\s*(?:e|err|error|ex|cause)\s*\)|\b(?:e|err|error|ex|cause)\s*\.\s*stack\b/;
const RAW_MESSAGE = /^\s*(?:e|err|error|ex|cause)\s*\.\s*message\s*$/;

const isSentence = (s: string) => /\s/.test(s.trim()) && /^[A-Z₹"'(]/.test(s.trim());

type Found = { node: ts.Node; text: string; context: string };

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "console") return null;
    return expr.name.text;
  }
  return null;
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/** Literal text with each `${…}` replaced by {x}; null for non-literals. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => `{x}${s.literal.text}`).join("");
  return null;
}

/** Every string literal inside `node` (objects, arrays, conditionals, concatenations, calls). */
function literalsWithin(node: ts.Node, out: ts.Node[]) {
  const t = literalText(node);
  if (t !== null) {
    out.push(node);
    return;
  }
  // Keys of an object literal are names, not messages.
  if (ts.isPropertyAssignment(node)) return literalsWithin(node.initializer, out);
  if (ts.isComputedPropertyName(node)) return;
  // `a === "TimeoutError" ? x : y`: the condition is a test, not text; only the branches are shown.
  if (ts.isConditionalExpression(node)) {
    literalsWithin(node.whenTrue, out);
    literalsWithin(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword].includes(node.operatorToken.kind)) return;
  // `.includes("x")`, `.test(…)`, `.startsWith("x")` inside a value are tests too.
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["includes", "test", "startsWith", "endsWith", "match", "get", "has"].includes(node.expression.name.text)) return;
  ts.forEachChild(node, (c) => literalsWithin(c, out));
}

/** Expressions inside a template literal or a value, for the raw-exception check. */
function rawException(node: ts.Node, sf: ts.SourceFile): boolean {
  const text = node.getText(sf);
  if (RAW_EXCEPTION.test(text)) return true;
  if (RAW_MESSAGE.test(text) || (ts.isTemplateExpression(node) && node.templateSpans.some((s) => RAW_MESSAGE.test(s.expression.getText(sf))))) {
    // e.message is fine once e was narrowed to a known class: `if (e instanceof ClientNameError) …`.
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if ((ts.isIfStatement(p) || ts.isConditionalExpression(p)) && /\binstanceof\b/.test((ts.isIfStatement(p) ? p.expression : p.condition).getText(sf))) return false;
      if (ts.isFunctionLike(p)) break;
    }
    return true;
  }
  return false;
}

export function extractUserMessages(file: SourceFile): { line: number; text: string; context: string; raw: boolean }[] {
  const kind = file.path.endsWith(".tsx") || file.path.endsWith(".jsx") ? ts.ScriptKind.TSX : file.path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, kind);
  const found: Found[] = [];
  const raws: { node: ts.Node; context: string }[] = [];
  const seen = new Set<ts.Node>();
  const add = (node: ts.Node, context: string, sentencesOnly = false) => {
    const text = literalText(node);
    if (text === null || seen.has(node)) return;
    if (sentencesOnly && !isSentence(text)) return;
    seen.add(node);
    found.push({ node, text, context });
  };
  const addValue = (node: ts.Node, context: string, sentencesOnly = false) => {
    if (rawException(node, sf)) raws.push({ node, context });
    const lits: ts.Node[] = [];
    literalsWithin(node, lits);
    // A value like `cond ? "a" : "b"` or `x ?? "fallback"`: every literal branch is a message; calls inside
    // (e.g. `t("key")`) are skipped unless the literal looks like a sentence.
    for (const l of lits) {
      const direct = l === node || ts.isConditionalExpression(l.parent) || ts.isBinaryExpression(l.parent) || ts.isParenthesizedExpression(l.parent);
      add(l, context, sentencesOnly || !direct);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      if (name && MESSAGE_KEYS.has(name)) addValue(node.initializer, name, name === "message" || name === "reason");
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && FAIL_FNS.test(name)) node.arguments.forEach((a) => addValue(a, `${name}()`, true));
      else if (name && ZOD_FNS.has(name) && ts.isPropertyAccessExpression(node.expression)) node.arguments.forEach((a) => add(a, `.${name}()`, true));
      else if (name && SETTERS.test(name)) node.arguments.forEach((a) => addValue(a, `${name}()`, name !== "setError" && name !== "setErr" && name !== "setMsg"));
    } else if (ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      if (name && USER_FACING_ERRORS.includes(name)) (node.arguments ?? []).forEach((a) => addValue(a, `new ${name}()`, true));
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && TABLE_NAME.test(node.name.text) && node.initializer) {
      const lits: ts.Node[] = [];
      literalsWithin(node.initializer, lits);
      for (const l of lits) add(l, node.name.text, !ts.isStringLiteral(node.initializer) && !ts.isTemplateExpression(node.initializer) && !isMessageValue(l));
    } else if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name) && FN_NAME.test(node.name.text) && node.body) {
      const fnName = node.name.text;
      const walk = (n: ts.Node) => {
        if (ts.isReturnStatement(n) && n.expression) addValue(n.expression, `${fnName}()`, true);
        if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk);
      };
      ts.forEachChild(node.body, walk);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  return [
    ...found.filter((f) => !forIt(f.node, sf)).map((f) => ({ line: line(f.node), text: f.text, context: f.context, raw: false })),
    ...raws.filter((r) => !forIt(r.node, sf)).map((r) => ({ line: line(r.node), text: r.node.getText(sf), context: r.context, raw: true })),
  ];
}

/**
 * Setup instructions written for IT (server settings by name, for the CLI and the logs) are marked
 * with a `// plain-messages: for IT — <why>` comment on the statement. People never see that text:
 * userMessage() and plainAction() (src/lib/errors) put a plain sentence in its place.
 */
export const FOR_IT_MARK = "plain-messages: for IT";
function forIt(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let p: ts.Node | undefined = node; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isStatement(p) || ts.isPropertyAssignment(p) || ts.isClassElement(p)) {
      const comments = ts.getLeadingCommentRanges(sf.text, p.getFullStart()) ?? [];
      if (comments.some((c) => sf.text.slice(c.pos, c.end).includes(FOR_IT_MARK))) return true;
    }
  }
  return false;
}

/** A literal that is the value of a property in a message table (not a key, URL or class name). */
function isMessageValue(node: ts.Node): boolean {
  return ts.isPropertyAssignment(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isArrayLiteralExpression(node.parent);
}

/** Files the scan reads: app and lib source, and the Companion extension. Tests, fixtures and prompts are not messages. */
export function isMessageSource(path: string): boolean {
  if (!/\.(?:ts|tsx|js|mjs)$/.test(path)) return false;
  if (/\.test\.(?:ts|tsx|js)$|(?:^|\/)(?:__tests__|__fixtures__|__snapshots__)\//.test(path)) return false;
  if (path.startsWith("src/")) return !path.endsWith(".d.ts");
  if (path.startsWith("firm-os-companion-extension/")) return !path.endsWith("build.mjs");
  return false;
}

/**
 * Pages, components and route handlers never read an unknown error's own text except to log it:
 * `(e as Error).message` anywhere in src/app or src/components outside a console call is flagged,
 * wherever the text ends up (state, a redirect query, a flash cookie, a JSON body).
 */
const APP_RAW = /\(\s*\w+\s+as\s+Error\s*\)\s*\.\s*message/;
function appRawExceptions(f: SourceFile): Violation[] {
  if (!/^src\/(?:app|components)\//.test(f.path)) return [];
  const out: Violation[] = [];
  f.content.split(/\r?\n/).forEach((line, i) => {
    if (APP_RAW.test(line) && !/console\.(?:log|info|warn|error|debug)\s*\(/.test(line) && !/^\s*(?:\/\/|\*)/.test(line))
      out.push({ path: f.path, line: i + 1, rule: "plain-messages:raw-exception", snippet: `[app] ${line.trim().slice(0, 160)}` });
  });
  return out;
}

export function checkPlainMessages(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (!isMessageSource(f.path)) continue;
    const seen = new Set<number>();
    for (const v of appRawExceptions(f)) {
      seen.add(v.line);
      out.push(v);
    }
    const lines = f.content.split(/\r?\n/);
    for (const m of extractUserMessages(f)) {
      if (m.raw && seen.has(m.line)) continue;
      const problems = m.raw ? ["raw-exception (the text of an unexpected error is shown as it is; use userMessage(e, …))"] : messageProblems(m.text);
      for (const p of problems) out.push({ path: f.path, line: m.line, rule: `plain-messages:${p.split(" ")[0]}`, snippet: `[${m.context}] ${(m.raw ? m.text : JSON.stringify(m.text)).slice(0, 140)}  ←  ${lines[m.line - 1]?.trim().slice(0, 60) ?? ""}` });
    }
  }
  return out;
}

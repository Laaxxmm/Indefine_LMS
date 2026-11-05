// Tests for the Firm OS guard rules. Forbidden literals are assembled from pieces so this file
// passes the very scans it tests (verify:no-skip, verify:secrets, verify:no-portal, verify:ai-boundary).
import { describe, expect, it } from "vitest";
import {
  FIRM_OS_DIRS,
  LEGACY_GEMINI,
  LEGACY_PORTAL_READONLY,
  checkAiBoundary,
  checkNoDelete,
  checkNoPortal,
  checkNoSkip,
  checkSecrets,
  formatViolation,
  isSecretScanCandidate,
  type PortalAllow,
} from "./guards";

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join("\n") });
const rules = (vs: { rule: string }[]) => vs.map((v) => v.rule);
const DOT = ".";
const q = (s: string) => '"' + s + '"';

describe("no-skip", () => {
  const cases: [string, string][] = [
    ["no-skip:skip", "it" + DOT + "skip(" + q("x") + ", () => {});"],
    ["no-skip:skip", "describe" + DOT + "skip(" + q("x") + ", () => {});"],
    ["no-skip:skip", "it" + DOT + "skip" + "If(true)(" + q("x") + ", () => {});"],
    ["no-skip:only", "test" + DOT + "only(" + q("x") + ", () => {});"],
    ["no-skip:only", "describe" + DOT + "only(" + q("x") + ", () => {});"],
    ["no-skip:x-prefixed", "x" + "it(" + q("x") + ", () => {});"],
    ["no-skip:x-prefixed", "x" + "describe(" + q("x") + ", () => {});"],
    ["no-skip:x-prefixed", "  x" + "test(" + q("x") + ", () => {});"],
    ["no-skip:todo", "test" + DOT + "todo(" + q("later") + ");"],
    ["no-skip:todo", "it" + DOT + "todo(" + q("later") + ");"],
    ["no-skip:todo", "describe" + DOT + "concurrent" + DOT + "todo(" + q("later") + ");"],
  ];
  it.each(cases)("flags %s in: %s", (rule, line) => {
    const vs = checkNoSkip([file("tests/unit/a.test.ts", "import { it } from 'vitest';", line)]);
    expect(rules(vs)).toContain(rule);
    expect(vs[0].line).toBe(2);
  });

  it("scans src/, tests/ and scripts/ in ts, tsx, js and mjs", () => {
    const line = "it" + DOT + "only(" + q("x") + ", () => {});";
    for (const p of ["src/lib/a.test.tsx", "tests/e2e/a.spec.ts", "scripts/a.mjs", "src/x.js"]) {
      expect(checkNoSkip([file(p, line)])).toHaveLength(1);
    }
  });

  it("ignores other roots, other extensions and look-alikes", () => {
    const line = "it" + DOT + "only(" + q("x") + ", () => {});";
    expect(checkNoSkip([file("docs/a.ts", line), file("src/a.md", line), file("node_modules/x/a.ts", line)])).toEqual([]);
    const clean = file(
      "src/lib/a.ts",
      "it(" + q("works") + ", () => {});",
      "process" + DOT + "exit(1); onlyOnce(); skipped(); todoList" + DOT + "push(1); commonly(); fixit();",
      "logger" + DOT + "todo" + "s; describe(" + q("a") + ", () => {});",
    );
    expect(checkNoSkip([clean])).toEqual([]);
  });
});

describe("secrets", () => {
  const sec = (line: string, path = "src/lib/config.ts") => rules(checkSecrets([file(path, line)]));
  const A40 = "Ab3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9n";

  it("flags provider keys", () => {
    expect(sec("const k = " + q("sk-" + "ant-api03-" + A40))).toContain("secret:anthropic-key");
    expect(sec("XAI=" + "xai-" + A40)).toContain("secret:xai-key");
    expect(sec("const k = " + q("sk-" + A40))).toContain("secret:openai-key");
    expect(sec("const k = " + q("sk-" + "proj-" + A40))).toContain("secret:openai-key");
    expect(sec("aws_access_key_id = " + "AKIA" + "IOSFODNN7EXAMPLE")).toContain("secret:aws-access-key");
    expect(sec("-----BEGIN " + "RSA PRIVATE KEY-----")).toContain("secret:private-key");
    expect(sec("-----BEGIN " + "EC PRIVATE KEY-----")).toContain("secret:private-key");
    expect(sec("-----BEGIN " + "PRIVATE KEY-----")).toContain("secret:private-key");
    expect(sec("GH=" + "ghp" + "_" + A40)).toContain("secret:github-token");
    expect(sec("GH=" + "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnop")).toContain("secret:github-token");
    expect(sec("key: " + q("AI" + "za" + "SyA-1234567890abcdefghijklmnopqrstu"))).toContain("secret:google-api-key");
  });

  it("flags a JWT assigned to a secret-ish name", () => {
    const jwt = "ey" + "JhbGciOiJIUzI1NiJ9" + DOT + "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0" + DOT + "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(sec("const sessionToken = " + q(jwt))).toContain("secret:jwt");
    expect(sec("Authorization: " + "Bearer " + jwt)).toContain("secret:jwt");
  });

  it("flags generic long secret assignments", () => {
    expect(sec("const api" + "_key = " + q("abcdEFGH12345678wxyz"))).toContain("secret:generic-assignment");
    expect(sec("pass" + "word: '" + "Zq8!vN2#rT6@kL0$" + "'")).toContain("secret:generic-assignment");
    expect(sec("TOK" + "EN=" + q("0123456789abcdef0123"))).toContain("secret:generic-assignment");
  });

  it("does not flag placeholders, short values, env reads or prose", () => {
    expect(sec("const api" + "_key = process.env.GEMINI_API_KEY;")).toEqual([]);
    expect(sec("tok" + "en: " + q("short"))).toEqual([]);
    expect(sec("sec" + "ret: " + q("<paste-the-value-here>"))).toEqual([]);
    expect(sec("sec" + "ret = " + q("run: openssl rand -base64 32"))).toEqual([]);
    expect(sec("// keys look like sk" + "-... and live in the env")).toEqual([]);
    expect(sec("const cls = " + q("task-" + A40))).toEqual([]);
  });

  it("allows .env.example only with empty or placeholder values", () => {
    const ok = file(
      ".env.example",
      "AUTH_SEC" + "RET=" + q("run: openssl rand -base64 32"),
      "MS_CLIENT_SEC" + "RET=" + q(""),
      "GRAPH_TOKEN_" + "KEY=",
      "AUTH_URL=" + q("http://localhost:3000"),
      "AUTH_MICROSOFT_ENTRA_ID_ISSUER=" + q("https://login.microsoftonline.com/<tenant-id>/v2.0"),
    );
    expect(checkSecrets([ok])).toEqual([]);
    const bad = file(".env.example", "CRON_SEC" + "RET=" + q("abc123"));
    expect(rules(checkSecrets([bad]))).toEqual(["secret:env-example-value"]);
  });

  it("chooses scan candidates: text yes; node_modules, lockfiles, binaries no", () => {
    expect(isSecretScanCandidate("src/lib/a.ts")).toBe(true);
    expect(isSecretScanCandidate(".env.example")).toBe(true);
    expect(isSecretScanCandidate(".github/workflows/ci.yml")).toBe(true);
    for (const p of ["node_modules/x/index.js", "package-lock.json", "statutory-extension.zip", "a/b.pdf", "public/logo.png"]) {
      expect(isSecretScanCandidate(p)).toBe(false);
    }
    expect(checkSecrets([file("package-lock.json", "sk-" + "ant-api03-" + A40)])).toEqual([]);
  });
});

describe("no-portal", () => {
  const GST = "gst" + ".gov" + ".in";
  const MCA = "mca" + ".gov" + ".in";
  const IT = "incometax" + ".gov" + ".in";
  const TDS = "tdscpc" + ".gov" + ".in";

  it("flags each portal host and its subdomains in scanned roots", () => {
    for (const [p, host] of [
      ["src/lib/x.ts", "https://www." + GST + "/returns"],
      ["scripts/x.ts", "https://services." + GST],
      ["src/app/api/x/route.ts", "https://www." + MCA],
      ["statutory-extension/x.js", "https://eportal." + IT + "/iec"],
      ["neo-centra-extension/x.js", "https://www." + TDS + "/app"],
      ["src/lib/x.ts", "https://" + GST.toUpperCase()],
    ]) {
      const vs = checkNoPortal([file(p, "const u = " + q(host) + ";")], []);
      expect(rules(vs), `${p} ${host}`).toEqual(["no-portal:host"]);
    }
  });

  it("ignores look-alike hosts and unscanned roots", () => {
    const lookalikes = file(
      "src/lib/x.ts",
      q("https://cbic-" + GST + "/tickers.html"),
      q("https://www.incometax" + "india.gov.in/"),
      q("https://taxinformation.cbic.gov.in/"),
      q("https://" + GST + "x.example/"),
    );
    expect(checkNoPortal([lookalikes], [])).toEqual([]);
    expect(checkNoPortal([file("docs/inventory.md", GST)], [])).toEqual([]);
  });

  const scraper: PortalAllow = { path: "src/lib/statutory/reader.ts", kind: "read-only-scraper", why: "test" };
  const doc: PortalAllow = { path: "src/lib/certificates/templates/t.ts", kind: "document-text", why: "test" };

  it("allows an allowlisted read-only scraper that only GETs", () => {
    const f = file(scraper.path, "const base = " + q("https://www." + IT + "/iec/foportal/latest-news") + ";", "await fetch(base);");
    expect(checkNoPortal([f], [scraper])).toEqual([]);
  });

  it("fails an allowlisted scraper that shows signs of submission", () => {
    const base = "const base = " + q("https://www." + GST) + ";";
    expect(rules(checkNoPortal([file(scraper.path, base, "await fetch(base + '/log" + "in');")], [scraper]))).toContain(
      "no-portal:submission-signal",
    );
    expect(rules(checkNoPortal([file(scraper.path, base, "const otpField = 1;")], [scraper]))).toContain("no-portal:submission-signal");
    expect(rules(checkNoPortal([file(scraper.path, base, "signWithDSC();")], [scraper]))).toEqual([]); // DSC inside a word
    expect(rules(checkNoPortal([file(scraper.path, base, "const dsc = sign();")], [scraper]))).toContain("no-portal:submission-signal");
    expect(rules(checkNoPortal([file(scraper.path, base, "form" + DOT + "submit();")], [scraper]))).toContain("no-portal:submission-signal");
    const post = file(scraper.path, base, "await fetch(base + '/returns', {", "  method: " + q("POST") + ",", "});");
    expect(rules(checkNoPortal([post], [scraper]))).toContain("no-portal:post-to-portal");
  });

  it("does not treat a POST far from any portal host as a portal post", () => {
    const lines = ["const base = " + q("https://www." + GST) + ";", ...Array(20).fill("// ..."), "await fetch(LMS_URL, { method: 'POST' });"];
    expect(checkNoPortal([file(scraper.path, ...lines)], [scraper])).toEqual([]);
  });

  it("allows document-text citations only in files with no network code", () => {
    const text = "t(" + q(" from the Income Tax Department website (https://www." + IT + "/iec/foportal/) from the log" + "in of the Assessee ") + "),";
    expect(checkNoPortal([file(doc.path, text)], [doc])).toEqual([]);
    expect(rules(checkNoPortal([file(doc.path, text, "await fetch(url);")], [doc]))).toContain("no-portal:network-call-in-document");
    expect(rules(checkNoPortal([file(doc.path, text, "x" + DOT + "submit();")], [doc]))).toContain("no-portal:submission-signal");
  });

  it("never lets a Firm OS directory onto the allowlist", () => {
    for (const dir of FIRM_OS_DIRS) {
      const entry: PortalAllow = { path: dir + "/reader.ts", kind: "read-only-scraper", why: "test" };
      const f = file(entry.path, "await fetch(" + q("https://www." + GST + "/news") + ");");
      const r = rules(checkNoPortal([f], [entry]));
      expect(r, dir).toContain("no-portal:firm-os-allowlisted");
      expect(r, dir).toContain("no-portal:host");
    }
  });

  it("ships an allowlist of exact legacy paths, none in Firm OS code, each with a reason", () => {
    expect(LEGACY_PORTAL_READONLY.length).toBeGreaterThan(0);
    for (const a of LEGACY_PORTAL_READONLY) {
      expect(a.why.length).toBeGreaterThan(20);
      expect(a.path).not.toMatch(/[*?]/);
      expect(FIRM_OS_DIRS.some((d) => a.path.startsWith(d + "/"))).toBe(false);
    }
  });

  it("formats violations as path:line  rule  snippet", () => {
    const [v] = checkNoPortal([file("src/lib/x.ts", "", "  fetch(" + q("https://" + GST) + ")")], []);
    expect(formatViolation(v)).toBe(`src/lib/x.ts:2  no-portal:host  fetch(${q("https://" + GST)})`);
  });
});

describe("no-delete", () => {
  const nd = (...lines: string[]) => rules(checkNoDelete([file("src/lib/integrations/turia/adapter.ts", ...lines)]));

  it("flags HTTP DELETE", () => {
    expect(nd("await fetch(url, { method: " + q("DELETE") + " });")).toContain("no-delete:http-delete");
    expect(nd("await fetch(url, { method: 'DELETE' });")).toContain("no-delete:http-delete");
  });

  it("flags Prisma delete and deleteMany", () => {
    expect(nd("await prisma.jobTask.delete({ where: { id } });")).toContain("no-delete:prisma-delete");
    expect(nd("await prisma.jobTask.deleteMany({});")).toContain("no-delete:prisma-delete");
  });

  it("flags exported destructive functions", () => {
    expect(nd("export async function deleteSite(id: string) {")).toContain("no-delete:exported-destructive-fn");
    expect(nd("export function removeFile() {}")).toContain("no-delete:exported-destructive-fn");
    expect(nd("export const purgeCache = () => {};")).toContain("no-delete:exported-destructive-fn");
    expect(nd("export function destroy() {}")).toContain("no-delete:exported-destructive-fn");
    expect(nd("export default async function dropTable() {}")).toContain("no-delete:exported-destructive-fn");
    expect(nd("export { helper, removeItem };")).toContain("no-delete:exported-destructive-fn");
  });

  it("flags destructive methods on adapters, interfaces and objects", () => {
    expect(nd("  async deleteItem(id: string) {")).toContain("no-delete:destructive-method");
    expect(nd("  deleteItem(id: string): Promise<void>;")).toContain("no-delete:destructive-method");
    expect(nd("  remove(id) {")).toContain("no-delete:destructive-method");
    expect(nd("  purgeAll: async () => {},")).toContain("no-delete:destructive-method");
    expect(nd("  destroy = async () => {};")).toContain("no-delete:destructive-method");
  });

  it("flags destructive Graph helpers imported from @/lib/graph", () => {
    expect(nd("import { getDriveItem, deleteDriveItem } from " + q("@/lib/graph") + ";")).toContain("no-delete:graph-import");
    expect(nd("import {", "  deleteEvent,", "} from '@/lib/graph';")).toContain("no-delete:graph-import");
    expect(nd("import { sendMailAsUser as send } from '@/lib/graph';")).toContain("no-delete:graph-import");
    expect(nd("await graph.deleteDriveItem(id);")).toContain("no-delete:graph-member");
  });

  it("allows archive-style code and look-alike names", () => {
    expect(
      nd(
        "import { getDriveItem } from '@/lib/graph';",
        "export async function archiveSite(id: string) {",
        "  await prisma.jobTask.update({ where: { id }, data: { archived: true } });",
        "}",
        "const dropdownOpen = false; const removed = 0;",
        "export function dropdownLabel() {}",
        "  removedCount: 0,",
        "  delete obj[key];",
        "  removeListener(handler);",
      ),
    ).toEqual([]);
  });

  it("scans only Firm OS paths", () => {
    const bad = "export function deleteDriveItem() {}";
    expect(checkNoDelete([file("src/lib/graph.ts", bad), file("src/app/work/page.tsx", bad)])).toEqual([]);
    for (const p of ["src/lib/audit/log.ts", "src/lib/rbac/policy.ts", "scripts/verify-patha.ts", "scripts/map-legacy-folders.ts", "src/app/api/firm-os/x/route.ts"]) {
      expect(checkNoDelete([file(p, bad)]), p).toHaveLength(1);
    }
    expect(checkNoDelete([file("src/lib/ai-other/x.ts", bad)])).toEqual([]); // prefix is a directory, not a string
  });
});

describe("ai-boundary", () => {
  const SDK = "@anthropic" + "-ai/sdk";
  const ANTHROPIC_HOST = "api.anthropic" + ".com";
  const XAI_HOST = "api.x" + ".ai";
  const GEMINI = "generativelanguage" + ".googleapis.com";
  const ab = (path: string, ...lines: string[]) => rules(checkAiBoundary([file(path, ...lines)]));

  it("flags SDK imports outside src/lib/ai/providers/", () => {
    expect(ab("src/lib/ai/router.ts", "import Anthropic from " + q(SDK) + ";")).toEqual(["ai-boundary:sdk-import"]);
    expect(ab("src/lib/x.ts", "import type { Message } from '" + SDK + "/resources';")).toEqual(["ai-boundary:sdk-import"]);
    expect(ab("src/lib/x.ts", "const OpenAI = require(" + q("open" + "ai") + ");")).toEqual(["ai-boundary:sdk-import"]);
    expect(ab("src/lib/x.ts", "const m = await import(" + q("@google/" + "genai") + ");")).toEqual(["ai-boundary:sdk-import"]);
    expect(ab("src/lib/x.ts", "import { GoogleGenerativeAI } from " + q("@google/" + "generative-ai") + ";")).toEqual(["ai-boundary:sdk-import"]);
    expect(ab("scripts/x.mjs", "export { default } from " + q("open" + "ai") + ";")).toEqual(["ai-boundary:sdk-import"]);
  });

  it("flags provider host string literals outside providers", () => {
    expect(ab("src/lib/x.ts", "const u = " + q("https://" + ANTHROPIC_HOST + "/v1/messages") + ";")).toEqual(["ai-boundary:provider-host"]);
    expect(ab("src/lib/x.ts", "const u = `https://" + XAI_HOST + "/v1/chat`;")).toEqual(["ai-boundary:provider-host"]);
  });

  it("allows all of it under src/lib/ai/providers/", () => {
    expect(ab("src/lib/ai/providers/claude.ts", "import Anthropic from " + q(SDK) + ";", "const u = " + q("https://" + ANTHROPIC_HOST) + ";")).toEqual([]);
    expect(ab("src/lib/ai/providers/grok.ts", "const u = " + q("https://" + XAI_HOST) + ";")).toEqual([]);
  });

  it("does not flag look-alikes", () => {
    expect(ab("src/lib/x.ts", "import { z } from 'zod';", "const openai = 1; // talks to the provider via the router", "import x from 'openai-compat-shim';")).toEqual([]);
  });

  it("allows Gemini REST only in the frozen legacy list", () => {
    const line = "const BASE = " + q("https://" + GEMINI) + ";";
    for (const p of LEGACY_GEMINI) expect(ab(p, line), p).toEqual([]);
    expect(ab("src/lib/new-feature.ts", line)).toEqual(["ai-boundary:gemini-rest"]);
    expect(ab("src/lib/ai/router.ts", line)).toEqual(["ai-boundary:gemini-rest"]);
  });

  it("skips non-code files and node_modules", () => {
    expect(ab("docs/x.md", "import Anthropic from " + q(SDK))).toEqual([]);
    expect(ab("node_modules/x/index.js", "import Anthropic from " + q(SDK))).toEqual([]);
  });
});

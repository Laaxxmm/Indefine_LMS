// The owner's rule, made permanent: "for each task, the error messages I get should directly tell me
// what the error is — no codes on the error messages."
//
//   1. self-test   the rules (src/lib/errors/rules.ts) catch codes and jargon, and let the firm's
//                  own words through (GSTIN, PAN, ARN, GSTR-3B, CL-12, FY2026-27, ₹1,00,000, file names)
//   2. repo scan   every message a person can see — route JSON `error` values, service failures,
//                  zod messages, thrown user errors, UI setters and message tables, the Companion
//                  extension — passes the rules, and no raw exception text is shown
//                  (scripts/lib/plain-messages.ts)
//   3. runtime     every sentence the message tables and helpers produce passes the rules, and
//                  userMessage() never passes an unexpected error's own text through
//   4. the UI      shows only `error`: call() never puts a `code` into the sentence, and no page
//                  renders a response's `code` field
import { describe, expect, it, vi } from "vitest";
import { loadFiles } from "../../scripts/lib/repo-files";
import { checkPlainMessages, extractUserMessages, isMessageSource } from "../../scripts/lib/plain-messages";
import {
  CODE_ALIASES,
  DEFAULT_MESSAGE,
  PlainError,
  USER_MESSAGES,
  causeSentence,
  isPlainMessage,
  messageProblems,
  responseError,
  runFailureMessage,
  statusMessage,
  storedFailureMessage,
  userMessage,
  validationMessage,
  type UserMessageCode,
} from "@/lib/errors";
import { ALLOWED_CAPS, BARE_PHRASES, JARGON } from "@/lib/errors/rules";
import { renderHtml } from "./routes/harness";

const plain = (s: string) => expect(messageProblems(s), s).toEqual([]);

describe("1. the rules", () => {
  it("catch status numbers, constants, database codes, exception names, stack frames, jargon and bare phrases", () => {
    const bad: [string, string][] = [
      ["HTTP 403 from the server", "http-status"],
      ["403 Forbidden", "http-status"],
      ["Claude unavailable (529)", "http-status"],
      ["409: conflict", "http-status"],
      ["status 500", "http-status"],
      ["Refused: NO_SCOPE", "constant-code"],
      ["AI_RESTRICTED", "constant-code"],
      ["The job is IN_REVIEW", "constant-code"],
      ["CONFLICT while saving", "constant-code"],
      ["Unique constraint failed (P2002)", "prisma-code"],
      ["TypeError: Cannot read properties", "error-prefix"],
      ["PrismaClientKnownRequestError was thrown", "error-prefix"],
      ["Error while saving", "error-prefix"],
      ["at handler (src/app/api/x/route.ts:12:5)", "stack-frame"],
      ["The zod schema rejected the payload", "jargon"],
      ["Invalid CSRF token", "jargon"],
      ["Prisma could not connect", "jargon"],
      ["Missing Content-Length header", "jargon"],
      ["Open the record again; its id is missing.", "jargon"],
      ["videoId required", "raw-identifier"],
      ["turia_ref is empty", "raw-identifier"],
      ["Unauthorized", "bare-phrase"],
      ["Not found", "bare-phrase"],
      ["Invalid request", "bare-phrase"],
      ["Something went wrong", "bare-phrase"],
      ["Unknown agent gst", "unknown-internal"],
      ["director required", "developer-required"],
      ["Saved!", "exclamation"],
    ];
    for (const [text, rule] of bad) expect(messageProblems(text).map((p) => p.split(" ")[0]), text).toContain(rule);
  });

  it("let the firm's own words, form names, amounts, dates and file names through", () => {
    for (const ok of [
      "Enter the client's GSTIN and PAN, then save.",
      "Enter the ARN or SRN from the portal acknowledgement.",
      "The TDS return (24Q) for Q2 is ready for review.",
      "GSTR-3B for October is due on 20 Nov 2026.",
      "Rule CL-12 failed: the sales register total does not tie.",
      "AOC-4 and MGT-7 are due 30 days after the AGM.",
      "Period 2027-04 is outside FY2026-27.",
      "The total is ₹1,00,000.00 for FY 2026-27.",
      "Keep the note to 500 characters or fewer.",
      "sales.xlsx!Sheet1 row 5: taxable is not an amount",
      "company.json is not a valid .json file. Export it again and upload it.",
      "Upload the PDF, XLSX or CSV file again.",
      "Enter the PAN as 10 characters, like ABCDE1234F.",
      "The Schedule III head of 2 ledgers cannot be told from the name.",
      "CARO 2020 applies; see the CARO sheet.",
      "Export the monthly attendance report from greytHR as CSV and upload it.",
      "Only a partner can approve this SOP change. Ask a partner.",
      DEFAULT_MESSAGE,
    ])
      plain(ok);
  });

  it("are data: the allowlist, the jargon list and the bare phrases are plain lists", () => {
    for (const w of ["GSTIN", "PAN", "ARN", "SRN", "TDS", "ITR", "GST", "ROC", "MCA", "SOP", "PDF", "XLSX"]) expect(ALLOWED_CAPS).toContain(w);
    for (const w of ["zod", "schema", "payload", "prisma", "token", "csrf"]) expect(JARGON).toContain(w);
    for (const w of ["unauthorized", "not found", "invalid request", "something went wrong"]) expect(BARE_PHRASES).toContain(w);
  });
});

describe("2. repo scan", () => {
  it("the scanner finds messages in each place a person sees them, and flags raw exception text", () => {
    const sample = [
      `return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`,
      `return fail(404, \`Unknown agent \${key}\`);`,
      `const z1 = z.string().regex(/x/, "Invalid job id");`,
      `throw new CloseLoopError("state", \`The job is \${s} — IN_PREP\`);`,
      `setError((e as Error).message);`,
      `export const MSG = { a: "No pairing token was sent." };`,
      `return NextResponse.json({ error: e.message }, { status: 400 });`,
      `if (e instanceof ClientNameError) return NextResponse.json({ error: e.message }, { status: 400 });`,
    ].join("\n");
    const found = extractUserMessages({ path: "src/app/api/x/route.ts", content: sample });
    expect(found.map((m) => m.text)).toEqual(
      expect.arrayContaining(["Unauthorized", "Unknown agent {x}", "Invalid job id", "The job is {x} — IN_PREP", "No pairing token was sent.", "(e as Error).message", "e.message"]),
    );
    const v = checkPlainMessages([{ path: "src/app/api/x/route.ts", content: sample }]);
    expect(v.map((x) => x.line)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]));
    expect(v.some((x) => x.line === 8)).toBe(false); // e.message after `instanceof` is a module's own sentence
  });

  it("every message a person can see in src/ and the Companion extension is plain", () => {
    const files = loadFiles(isMessageSource);
    expect(files.length).toBeGreaterThan(600);
    expect(files.some((f) => f.path.startsWith("firm-os-companion-extension/"))).toBe(true);
    expect(checkPlainMessages(files).map((v) => `${v.path}:${v.line}  ${v.rule}  ${v.snippet}`)).toEqual([]);
  });
});

describe("3. runtime: every sentence the helpers produce", () => {
  const contexts = [{}, { subject: "the GST pack", byHand: "prepare it by hand" }, { wait: "40 minutes" }, { fallback: "The draft could not be saved. Try again." }];

  it("each USER_MESSAGES entry, with and without context, is one or two plain sentences ending in a full stop", () => {
    for (const [code, fn] of Object.entries(USER_MESSAGES)) {
      for (const c of contexts) {
        const s = fn(c);
        plain(s);
        expect(s, code).toMatch(/[.]$/);
        expect(s.split(/(?<=[.?])\s+(?=[A-Z])/).length, code).toBeLessThanOrEqual(3);
      }
    }
    expect(USER_MESSAGES.aiUnavailable({ subject: "the pack", byHand: "prepare it by hand" })).toBe(
      "The AI service is unavailable right now. The pack wasn't changed — try again in a few minutes, or prepare it by hand.",
    );
  });

  it("codes, statuses and stored failures all become sentences", () => {
    for (const code of Object.keys(CODE_ALIASES)) plain(userMessage(code));
    for (const code of Object.keys(USER_MESSAGES) as UserMessageCode[]) plain(userMessage(code));
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504, 599]) {
      plain(statusMessage(status));
      plain(responseError(status, {}));
      plain(responseError(status, { code: "NOT_FOUND" }));
    }
    for (const stored of [
      "Model output not usable (schema: invalid at items.[].amount)",
      "Model call queued for a human: local model down",
      "Scope violation: task gst.read-2b is not in the agent's scope",
      "provider: Claude unavailable (529)",
      "provider: Claude rejected the credentials (401)",
      "AI budget for this run is exhausted: ₹0.18 spent of ₹0.10 allowed (maxCostInr).",
      "Daily AI budget is exhausted: ₹7.50 spent today (IST) of ₹5.00 allowed (AI_DAILY_BUDGET_INR).",
      "Model output for gst.classify is not grounded in the documents: items.0 quote not found",
      "BLOCKED: Set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET",
      "GET https://graph.microsoft.com/v1.0/drives/x failed: 503 Service Unavailable",
      "TypeError: Cannot read properties of undefined (reading 'x')\n    at run (src/lib/agents/core/runner.ts:12:5)",
      "",
    ]) {
      plain(runFailureMessage(stored));
      plain(storedFailureMessage(stored));
      expect(runFailureMessage(stored)).not.toContain(stored || "\u0000");
    }
  });

  it("userMessage never shows an unexpected error's own text; known causes get their own sentence", () => {
    const named = (name: string, props: Record<string, unknown> = {}, message = "raw provider text 529 {\"type\":\"overloaded_error\"}") => Object.assign(new Error(message), { name }, props);
    const cases: [unknown, RegExp][] = [
      [named("BudgetExceededError", { scope: "day" }), /Today's AI budget for the firm is used up/],
      [named("BudgetExceededError", { scope: "run" }), /spending limit/],
      [named("ProviderError", { kind: "outage" }), /AI service is unavailable/],
      [named("ProviderError", { kind: "rate_limit" }), /AI service is unavailable/],
      [named("ProviderError", { kind: "auth" }), /not set up/],
      [named("ProviderError", { kind: "refusal" }), /declined/],
      [named("ProviderUnavailableError"), /not set up/],
      [named("NoProviderAvailableError"), /AI service is unavailable/],
      [named("ProviderOutputError"), /could not use/],
      [named("GroundingError"), /not in the uploaded documents/],
      [named("ScopeViolationError"), /outside what this job allows/],
      [named("DictionaryUnavailableError"), /could not be hidden/],
      [named("GraphError", { status: 403 }), /refused access/],
      [named("GraphError", { status: 404 }), /no longer in SharePoint/],
      [named("GraphError", { status: 503 }), /could not be reached/],
      [named("PrismaClientKnownRequestError", { code: "P2002" }), /already exists/],
      [named("PrismaClientKnownRequestError", { code: "P2025" }), /wasn't found/],
      [named("PrismaClientKnownRequestError", { code: "P1001" }), /records could not be reached/],
      [named("PrismaClientInitializationError"), /records could not be reached/],
      [new TypeError("Failed to fetch"), /could not be reached/],
      [named("AbortError"), /took too long/],
      [new Error("Cannot read properties of undefined (reading 'x')"), /^Something went wrong on our side/],
      ["not-a-code and not plain: P2002", /^Something went wrong on our side/],
      [null, /^Something went wrong on our side/],
    ];
    for (const [err, re] of cases) {
      const s = userMessage(err, { subject: "the GST pack" });
      plain(s);
      expect(s).toMatch(re);
      expect(s).not.toContain("raw provider text");
    }
    // A sentence written for a person passes through; a fallback replaces the default.
    expect(userMessage(new PlainError("Upload the sales register for October first."))).toBe("Upload the sales register for October first.");
    expect(userMessage(new Error("boom"), { fallback: "The draft could not be saved. Try again." })).toBe("The draft could not be saved. Try again.");
    // causeSentence keeps plain causes, drops codes.
    expect(causeSentence(new Error("register unreadable"))).toBe("Register unreadable.");
    expect(causeSentence(new Error("Claude unavailable (503)"))).toBeNull();
    // Zod's own wording is replaced; a schema's sentence is kept.
    expect(validationMessage({ issues: [{ message: "Required" }] })).toBe(USER_MESSAGES.badRequest());
    expect(validationMessage({ issues: [{ message: "Expected string, received number" }] })).toBe(USER_MESSAGES.badRequest());
    expect(validationMessage({ issues: [{ message: "Enter the Turia reference." }] })).toBe("Enter the Turia reference.");
  });

  it("the message tables of each module are plain", async () => {
    const { MSG } = await import("@/lib/companion/messages");
    const { FIRM_OS_OFF_MESSAGE } = await import("@/lib/workspace/flag");
    const { BUSY_MESSAGE, RATE_LIMIT_SCOPES, rateLimitSentence } = await import("@/lib/hardening/rate-limit");
    const { agentRunBusyMessage } = await import("@/lib/hardening/concurrency");
    const { AI_RESTRICTED_MESSAGE, COMMS_RESTRICTED_MESSAGE } = await import("@/lib/privacy/consent");
    const { budgetMessage, NO_DICTIONARY_MESSAGE } = await import("@/lib/agents/core/guardrails/session");
    const { BudgetExceededError } = await import("@/lib/ai/errors");
    const { checkBody } = await import("@/lib/hardening/body-limits");
    const { checkUpload } = await import("@/lib/hardening/uploads");
    const { STATE_WORDS, canTransition } = await import("@/lib/agents/core/state");
    const sentences = [
      ...Object.values(MSG),
      FIRM_OS_OFF_MESSAGE,
      BUSY_MESSAGE,
      ...RATE_LIMIT_SCOPES.flatMap((scope) => [rateLimitSentence({ scope, limit: 30, retryAfterSec: 2400, windowMs: 3_600_000 }), rateLimitSentence({ scope, limit: 20, retryAfterSec: 30, windowMs: 60_000 })]),
      agentRunBusyMessage({ ok: false, reason: "queue-full", retryAfterSec: 60 }, 2),
      agentRunBusyMessage({ ok: false, reason: "timeout", retryAfterSec: 30 }, 2),
      AI_RESTRICTED_MESSAGE,
      COMMS_RESTRICTED_MESSAGE,
      budgetMessage(new BudgetExceededError("run", 1, 2)),
      budgetMessage(new BudgetExceededError("day", 1000, 1000)),
      NO_DICTIONARY_MESSAGE,
      ...Object.values(STATE_WORDS),
    ];
    for (const [contentLength, transferEncoding, hasSession] of [["99999999", null, true], ["12x", null, true], [null, "chunked", false]] as const) {
      const body = checkBody({ method: "POST", pathname: "/api/firm-os/onboard/start", contentLength, transferEncoding, hasSession, hasBearer: false });
      if (!body.ok) sentences.push(body.message);
    }
    const upload = checkUpload({ name: "virus.exe", size: 10, type: "application/x-msdownload" });
    if (!upload.ok) sentences.push(upload.reason);
    const mismatch = checkUpload({ name: "notes.pdf", size: 10, type: "application/x-msdownload" });
    if (!mismatch.ok) sentences.push(mismatch.reason);
    const huge = checkUpload({ name: "big.pdf", size: 900 * 1024 * 1024, type: "application/pdf" });
    if (!huge.ok) sentences.push(huge.reason);
    const human = { kind: "human" as const, userId: "u-staff", roles: ["staff" as const] };
    const ctx = { actor: human, jobTaskId: "j", service: "GST" as const, assigneeId: "u-other", reviewerId: "u-rev", now: new Date() };
    for (const [from, to] of [["IN_REVIEW", "APPROVED"], ["DRAFT", "DONE"], ["DRAFT", "IN_REVIEW"], ["APPROVED", "APPROVED"], ["APPROVED", "FILED_BY_HUMAN"]] as const) {
      const d = canTransition(from, to, ctx);
      if (!d.ok) sentences.push(d.reason);
    }
    expect(sentences.length).toBeGreaterThan(30);
    for (const s of sentences) plain(s);
  });
});

describe("4. the UI shows only `error`, never a code", () => {
  it("call() returns the response's sentence and keeps `code` out of it; a missing sentence or a network failure becomes one", async () => {
    const { call } = await import("@/components/ui");
    const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", reply(409, { error: "Someone else moved this job. Reload the page.", code: "conflict" }));
    const a = await call("/api/x", {});
    expect(a).toMatchObject({ ok: false, error: "Someone else moved this job. Reload the page.", data: { code: "conflict" } });
    expect(a.error).not.toMatch(/conflict|409/);
    vi.stubGlobal("fetch", reply(404, { code: "NOT_FOUND" }));
    const b = await call("/api/x", {});
    plain(b.error!);
    expect(b.error).not.toMatch(/NOT_FOUND|404/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    plain((await call("/api/x", {})).error!);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const c = await call("/api/x", {});
    expect(c).toMatchObject({ ok: false, error: USER_MESSAGES.offline() });
    vi.unstubAllGlobals();
  });

  it("the shared Alert shows the sentence from a failed call, not the code beside it", async () => {
    const { Alert } = await import("@/components/firm-os");
    const sentence = responseError(409, { error: "That draft was already created in Outlook. Open it there.", code: "conflict", status: 409 });
    const html = (await renderHtml(<Alert tone="error">{sentence}</Alert>)).replace(/<!-- -->/g, "");
    expect(html).toContain('role="alert"');
    expect(html).toContain("That draft was already created in Outlook. Open it there.");
    expect(html).not.toMatch(/conflict|409/);
  });

  it("no page or component renders a response's `code`, `status` or `stack` field", () => {
    const pages = loadFiles((p) => /^(?:src\/app|src\/components)\/.*\.tsx$/.test(p) && !/\.test\.tsx$/.test(p));
    expect(pages.length).toBeGreaterThan(100);
    // {r.data.code}, {error.code}, {String(res.code)}, {e.stack}, ${res.status}: a response's or error's code put on screen.
    const RENDERS_CODE = /\{\s*(?:String\()?\s*(?:r|res|result|resp|response|data|json|body|err|error|e|failure|out)(?:\.data)?\s*(?:\?\.|\.)\s*(?:code|stack)\b|\{\s*(?:res|resp|response)\s*(?:\?\.|\.)\s*status\s*\}/;
    const hits = pages.flatMap((f) =>
      f.content
        .split(/\r?\n/)
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => RENDERS_CODE.test(line) && !/^\s*(?:\/\/|\*)/.test(line) && !/console\.(?:warn|error|log|info)/.test(line))
        .map(({ line, i }) => `${f.path}:${i + 1}  ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("the plain-language helpers are what pages use: no page builds its own fallback text", () => {
    const pages = loadFiles((p) => /^(?:src\/app|src\/components)\/.*\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p));
    const hits = pages.filter((f) => /["']Something went wrong["']/.test(f.content)).map((f) => f.path);
    expect(hits).toEqual([]);
    expect(isPlainMessage(DEFAULT_MESSAGE)).toBe(true);
  });
});

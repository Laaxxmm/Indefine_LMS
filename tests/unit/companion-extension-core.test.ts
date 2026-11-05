// The side panel's pure logic (firm-os-companion-extension/core.js): which state to show for each
// API answer, plain messages, links that cannot leave the Firm OS origin, local ticks per job.
import { describe, expect, it } from "vitest";
import {
  MAX_POLL_MS,
  POLL_MS,
  TEXT,
  cleanMessage,
  companionPageUrl,
  interpret,
  isTaskResponse,
  isTokenShape,
  istTime,
  jobLink,
  nextPollDelay,
  nextTaskUrl,
  taskKey,
  ticksFor,
  tidyToken,
  whereLabel,
  withTick,
} from "../../firm-os-companion-extension/core.js";
import { LMS_ORIGIN } from "../../firm-os-companion-extension/config.js";
import { checkOrigin } from "../../firm-os-companion-extension/build.mjs";
import { MSG } from "@/lib/companion/messages";
import { fakeToken } from "@/lib/companion/__tests__/fakes";

const O = "https://lms.indefine.in";
const task = {
  status: "task",
  generatedAt: "2026-11-05T06:30:00.000Z",
  task: {
    jobId: "job-1",
    job: { title: "GSTR-3B", period: "2026-10", state: "APPROVED", clientName: "Acme", clientCode: "ACME", serviceLabel: "GST", fy: "2026-27" },
    steps: [{ n: 1, text: "Collect", where: "files", done: true, current: false }],
    checklist: ["Period selected is 2026-10"],
    values: [{ key: "clientCode", label: "Client code", copy: "ACME", display: "ACME" }],
  },
  later: [],
  counts: { open: 1, overdue: 0 },
};

describe("addresses", () => {
  it("talks to one origin: the configured Firm OS", () => {
    expect(LMS_ORIGIN).toBe(O);
    expect(nextTaskUrl(O)).toBe(`${O}/api/firm-os/companion/next-task`);
    expect(companionPageUrl(O)).toBe(`${O}/companion`);
  });

  it("job links stay on the Firm OS origin", () => {
    expect(jobLink(O, "/agents/gst/runs/run-1")).toBe(`${O}/agents/gst/runs/run-1`);
    expect(jobLink(O, "/agents")).toBe(`${O}/agents`);
    for (const bad of ["//evil.example/x", "https://evil.example/x", "agents", "/\\evil.example", "javascript:alert(1)", null, 42]) expect(jobLink(O, bad as never)).toBeNull();
  });

  it("the build accepts only an https origin (or localhost) and never a government host", () => {
    expect(checkOrigin("https://staging.indefine.in")).toBe("https://staging.indefine.in");
    expect(checkOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://lms.indefine.in", "https://lms.indefine.in/path", "https://x.gov.in", "ftp://x", "not a url", "https://u:p@x.in"]) expect(checkOrigin(bad)).toBeNull();
  });
});

describe("interpret — one state per answer", () => {
  it("200 task / none; anything else at 200 is not trusted", () => {
    expect(interpret({ kind: "http", status: 200, body: task })).toEqual({ view: "task", data: task });
    expect(interpret({ kind: "http", status: 200, body: { status: "none", message: MSG.caughtUp } })).toEqual({ view: "none", message: "You're all caught up." });
    expect(interpret({ kind: "http", status: 200, body: { status: "task", task: { jobId: 1 } } })).toEqual({ view: "error", message: TEXT.unexpected });
    expect(interpret({ kind: "http", status: 200, body: null }).view).toBe("error");
  });

  it("401 → pairing (the server's sentence, or the expired sentence), 403 → no access, 429 → busy, 5xx → error, network → offline", () => {
    expect(interpret({ kind: "http", status: 401, body: { error: MSG.tokenRevoked } })).toEqual({ view: "pairing", message: MSG.tokenRevoked });
    expect(interpret({ kind: "http", status: 401, body: null })).toEqual({ view: "pairing", message: "Your pairing has expired. Create a new one on the Companion page in Firm OS." });
    expect(interpret({ kind: "http", status: 403, body: { error: MSG.noAccess } })).toEqual({ view: "noaccess", message: MSG.noAccess });
    expect(interpret({ kind: "http", status: 429, body: { error: MSG.rateLimited } })).toEqual({ view: "busy", message: MSG.rateLimited });
    expect(interpret({ kind: "http", status: 500, body: { error: "TypeError at line 4" } })).toEqual({ view: "error", message: TEXT.serverError });
    expect(interpret({ kind: "http", status: 502, body: null }).view).toBe("error");
    expect(interpret({ kind: "network" })).toEqual({ view: "offline", message: TEXT.offline });
  });

  it("shows a server sentence only when it is short and plain", () => {
    expect(cleanMessage({ error: "Plain sentence." }, "fallback")).toBe("Plain sentence.");
    expect(cleanMessage({ error: "<b>html</b>" }, "fallback")).toBe("fallback");
    expect(cleanMessage({ error: "x".repeat(301) }, "fallback")).toBe("fallback");
    expect(cleanMessage({ error: 404 }, "fallback")).toBe("fallback");
    expect(cleanMessage(null, "fallback")).toBe("fallback");
  });

  it("every sentence the extension writes is plain: no codes, no emoji", () => {
    for (const t of Object.values(TEXT)) {
      expect(t).toMatch(/^[A-Z].*[.]$/);
      expect(t).not.toMatch(/\b\d{3}\b|_|error code|unauthori[sz]ed|forbidden/i);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("checks the task shape before rendering", () => {
    expect(isTaskResponse(task)).toBe(true);
    expect(isTaskResponse({ ...task, task: { ...task.task, steps: [{ n: "1" }] } })).toBe(false);
    expect(isTaskResponse({ ...task, task: { ...task.task, values: [{ label: "x" }] } })).toBe(false);
  });
});

describe("local ticks, per job", () => {
  it("start empty for a new job and are kept for the same job", () => {
    const a = withTick(ticksFor(null, "job-1"), 3, true);
    expect(a).toEqual({ jobId: "job-1", done: [3] });
    expect(ticksFor(a, "job-1")).toEqual({ jobId: "job-1", done: [3] });
    expect(ticksFor(a, "job-2")).toEqual({ jobId: "job-2", done: [] }); // reset when the job changes
    expect(withTick(withTick(a, 1, true), 3, false)).toEqual({ jobId: "job-1", done: [1] });
    expect(withTick(a, 3, true)).toEqual({ jobId: "job-1", done: [3] }); // no duplicates
    expect(ticksFor({ jobId: "job-1", done: ["x", 2] }, "job-1")).toEqual({ jobId: "job-1", done: [2] });
  });
});

describe("small helpers", () => {
  it("labels where each step happens, saying when the person does it themselves", () => {
    expect(whereLabel("portal")).toBe("On the portal: you do this yourself");
    expect(whereLabel("offline")).toBe("Outside Firm OS: you do this yourself");
    expect(whereLabel("firm-os")).toBe("In Firm OS");
    expect(whereLabel("turia")).toBe("In Turia");
    expect(whereLabel("files")).toBe("Client files");
    expect(whereLabel("elsewhere")).toBe("");
  });

  it("tidies a pasted token and recognises its shape", () => {
    expect(tidyToken(`  Bearer ${fakeToken()}\n`)).toBe(fakeToken());
    expect(isTokenShape(tidyToken(` ${fakeToken()} `))).toBe(true);
    expect(isTokenShape("fosc_short")).toBe(false);
    expect(isTokenShape(undefined)).toBe(false);
  });

  it("shows update times in IST", () => {
    expect(istTime(new Date("2026-11-05T06:34:00Z"))).toBe("12:04");
    expect(istTime(new Date("2026-11-05T18:45:00Z"))).toBe("00:15");
  });
});

describe("polling rhythm", () => {
  it("every minute; while the same task keeps coming back it backs off to at most five minutes", () => {
    expect(POLL_MS).toBe(60_000);
    expect(MAX_POLL_MS).toBe(300_000);
    expect([0, 1, 2, 3, 9].map((n) => nextPollDelay("task", n))).toEqual([60_000, 120_000, 240_000, 300_000, 300_000]);
    // Views whose text promises "a minute" keep it: nothing waiting, offline, busy, errors.
    for (const v of ["none", "offline", "busy", "error", "pairing", "noaccess", ""]) expect(nextPollDelay(v, 5)).toBe(60_000);
  });

  it("an answer is 'the same task' when task, later and counts match (the server timestamp aside)", () => {
    expect(taskKey(task)).toBe(taskKey({ ...task, generatedAt: "2026-11-05T06:31:00.000Z" }));
    expect(taskKey(task)).not.toBe(taskKey({ ...task, counts: { open: 2, overdue: 0 } }));
    expect(taskKey(null)).toBe("");
  });
});

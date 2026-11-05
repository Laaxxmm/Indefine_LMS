// "Filing and close" on the /agents run review screen: the read model (loadCloseLoopView), the
// status card and the bottom-bar action per state, the form rules (ack ref required for
// GST / ROC / IncomeTax / TDS, minutes > 0), and the panel's calls driven through the real
// /api/firm-os/jobs/[id]/* route handlers by a mocked call(), over the in-memory close-loop world.
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmService, JobTaskState } from "@prisma/client";
import type { CallResult } from "@/components/ui";
import type { CloseLoopDeps } from "@/lib/close-loop/actions";
import type { CloseLoopView, CloseLoopViewDb } from "@/lib/close-loop/review";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld } from "../../fakes/close-loop-world";
import { activeSession, renderHtml as renderRaw } from "./harness";

let deps: CloseLoopDeps;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/close-loop/defaults", () => ({ closeLoopDeps: () => deps }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { ackRefFor, loadCloseLoopView } = await import("@/lib/close-loop/review");
const { ActionBar, CloseLoopStatus, filedBody, parseMinutes, recordFiling, recordTuriaClose, turiaCloseBody } = await import("@/app/agents/[agent]/runs/[id]/ReviewPanels");
const routes = {
  filed: (await import("@/app/api/firm-os/jobs/[id]/filed/route")).POST,
  "turia-close": (await import("@/app/api/firm-os/jobs/[id]/turia-close/route")).POST,
  state: (await import("@/app/api/firm-os/jobs/[id]/state/route")).POST,
};

const PORTAL_OR_SEND = />\s*(Submit to portal|Send[^<]*|File on portal)\s*</i;
const NO_ACTIONS = { run: false, submit: false, rerun: false, requestChanges: false, approve: false, approveNeedsNote: false, proposeMistake: false, finalize: false };
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const priya = () => activeSession({ id: "u-priya" });
const html = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const bar = (view: CloseLoopView | null, state: JobTaskState = view?.state ?? "APPROVED") =>
  html(createElement(ActionBar, { agent: "gst", runId: "run-1", jobId: view?.jobId ?? "job-1", jobState: state, actions: NO_ACTIONS, blockFails: 0, closeLoop: view }));
const status = (view: CloseLoopView) => html(createElement(CloseLoopStatus, { view }));

/** A mocked call() that hands the request to the real route handler, as fetch would. */
const send = vi.fn(async (url: string, body?: unknown): Promise<CallResult> => {
  const m = /^\/api\/firm-os\/jobs\/([^/]+)\/(filed|turia-close|state)$/.exec(url);
  if (!m) throw new Error(`unexpected url ${url}`);
  const req = new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await routes[m[2] as keyof typeof routes](req, { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) });
  const data = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, error: res.ok ? null : String(data.error), data };
});

/** CloseLoopViewDb over the close-loop world's tables. */
function viewDb(w: CloseLoopWorld): CloseLoopViewDb {
  return {
    jobTask: { findFirst: async ({ where }) => w.jobs.find((j) => j.id === where.id) ?? null },
    jobTaskEvent: { findMany: async ({ where }) => w.events.filter((e) => e.jobTaskId === where.jobTaskId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) },
    deliverable: { count: async ({ where }) => w.deliverables.filter((d) => d.jobTaskId === where.jobTaskId && d.kind === where.kind).length },
    turiaSync: { findMany: async ({ where }) => w.syncs.filter((s) => s.jobTaskId === where.jobTaskId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()) },
    auditEvent: {
      findFirst: async ({ where }) => {
        const a = [...w.audits].reverse().find((x) => x.entity === where.entity && x.entityId === where.entityId && x.action === where.action);
        return a ? { meta: a.meta, createdAt: a.createdAt } : null;
      },
    },
  };
}

let w: CloseLoopWorld;
let t = 0;
const view = (id: string, user = priya().user, isLatest = true) => loadCloseLoopView(viewDb(w), user, id, { isLatest });

beforeEach(() => {
  w = new CloseLoopWorld();
  t = 0;
  w.clock = () => new Date(Date.UTC(2026, 10, 5, 6, 0, t++));
  const manual = new ManualBridge(w.turiaRepo, w.clock);
  deps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal: async () => ({ copied: 1 }), now: w.clock };
  signedIn(priya());
  send.mockClear();
});

function approvedJob(service: FirmService = "GST", final = true) {
  const job = w.addJob({ state: "APPROVED", service, ackRef: null, filedAt: null, filedById: null });
  if (final) w.addFinal(job);
  return job;
}

describe("acknowledgement reference rules", () => {
  it("required for GST / ROC / IncomeTax / TDS with the portal's name for it; optional otherwise", () => {
    expect(ackRefFor("GST")).toEqual({ required: true, label: "GST ARN" });
    expect(ackRefFor("ROC")).toEqual({ required: true, label: "MCA SRN" });
    expect(ackRefFor("IncomeTax")).toEqual({ required: true, label: "ITR acknowledgement no." });
    expect(ackRefFor("TDS")).toEqual({ required: true, label: "TDS acknowledgement no." });
    for (const s of ["Books", "Audit", "Engagement"] as const) expect(ackRefFor(s)).toEqual({ required: false, label: "Acknowledgement reference" });
  });

  it("filedBody refuses an empty ack ref where required, trims and nulls the rest", () => {
    const empty = { ackRef: "  ", turiaTaskRef: "", minutes: "" };
    for (const s of ["GST", "ROC", "IncomeTax", "TDS"] as const) {
      expect(filedBody(ackRefFor(s), empty)).toEqual({ ok: false, error: `Enter the ${ackRefFor(s).label} from the portal acknowledgement` });
    }
    expect(filedBody(ackRefFor("Books"), empty)).toEqual({ ok: true, body: { ackRef: null, turiaTaskRef: null, minutes: null } });
    expect(filedBody(ackRefFor("GST"), { ackRef: " AA2710260012345 ", turiaTaskRef: " TT-9 ", minutes: "45" })).toEqual({
      ok: true,
      body: { ackRef: "AA2710260012345", turiaTaskRef: "TT-9", minutes: 45 },
    });
  });

  it("minutes are a whole number above 0 (and required to close in Turia)", () => {
    expect(parseMinutes("", false)).toEqual({ ok: true, minutes: null });
    expect(parseMinutes("", true)).toMatchObject({ ok: false });
    for (const bad of ["0", "-3", "1.5", "abc", "6001"]) expect(parseMinutes(bad, false)).toMatchObject({ ok: false });
    expect(parseMinutes(" 90 ", true)).toEqual({ ok: true, minutes: 90 });
    expect(turiaCloseBody({ turiaTaskRef: "", minutes: "10" })).toEqual({ ok: false, error: "Enter the Turia task ref" });
    expect(turiaCloseBody({ turiaTaskRef: "TT-1", minutes: "0" })).toMatchObject({ ok: false, error: expect.stringMatching(/more than 0/) });
    expect(turiaCloseBody({ turiaTaskRef: " TT-1 ", minutes: "30" })).toEqual({ ok: true, body: { turiaTaskRef: "TT-1", minutes: 30 } });
  });
});

describe("panel per state", () => {
  it("APPROVED: Mark filed is the one primary action; GST ack ref required (button disabled until typed); no portal or send action", async () => {
    const job = approvedJob("GST");
    const v = (await view(job.id))!;
    expect(v).toMatchObject({ state: "APPROVED", action: "mark-filed", hasFinal: true, ack: { required: true, label: "GST ARN" } });
    const out = await bar(v);
    expect(out).toContain("Filed by you on the portal — record the acknowledgement here.");
    expect(out).toContain("Firm OS never files anything");
    expect(out).toContain("GST ARN (required)");
    expect(out).toMatch(/<input[^>]*maxLength="64"[^>]*required=""/);
    expect(out).toContain("Turia task ref (optional)");
    expect(out).toContain("Minutes logged in Turia (optional)");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Mark filed<\/button>/);
    expect((out.match(/bg-brand-500/g) ?? []).length).toBe(1);
    expect(out).not.toMatch(PORTAL_OR_SEND);
    const card = await status(v);
    expect(card).toContain("Filing and close");
    expect(card).toContain("In the Final folder");
    expect(card).not.toMatch(PORTAL_OR_SEND);
  });

  it("APPROVED Books: the ack ref is optional, so Mark filed is enabled", async () => {
    const v = (await view(approvedJob("Books").id))!;
    const out = await bar(v);
    expect(out).toContain("Acknowledgement reference (optional)");
    expect(out).toMatch(/<button[^>]*>Mark filed<\/button>/);
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Mark filed/);
  });

  it("CLOSING: Close in Turia with ref + minutes required; the gate's reasons are shown", async () => {
    const job = approvedJob("GST", false);
    expect(await recordFiling(job.id, ackRefFor("GST"), { ackRef: "AA2710260012345", turiaTaskRef: "", minutes: "" }, send)).toEqual({ ok: true, state: "CLOSING" });
    const before = (await view(job.id))!;
    expect(before).toMatchObject({ state: "CLOSING", action: "turia-close", ackRef: "AA2710260012345", gate: null });
    const out = await bar(before);
    expect(out).toContain("Close the task in Turia yourself");
    expect(out).toContain("Filed with GST ARN AA2710260012345.");
    expect(out).toContain("Minutes logged in Turia");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Close in Turia<\/button>/); // empty ref + minutes
    expect(out).not.toMatch(PORTAL_OR_SEND);

    const r = await recordTuriaClose(job.id, { turiaTaskRef: "TT-77", minutes: "60" }, send);
    expect(r).toMatchObject({ ok: true, done: false, reasons: [expect.stringMatching(/No Final deliverable/)] });
    const after = (await view(job.id))!;
    expect(after).toMatchObject({ state: "CLOSING", action: "retry-close", turia: { status: "closed", ref: "TT-77", minutes: 60 } });
    expect(after.gate?.reasons).toEqual([expect.stringMatching(/No Final deliverable recorded/)]);
    const card = await status(after);
    expect(card).toContain("Still closing: the close gate did not pass");
    expect(card).toContain("No Final deliverable recorded");
    expect(card).toContain("Closed in Turia · TT-77 · 60 min logged");
    expect(card).toMatch(/Checked \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} IST/);
    expect(await bar(after)).toMatch(/>Check again<\/button>/);
  });

  it("DONE: no action; DONE chip with the cycle time and the close date as DD MMM YYYY IST", async () => {
    const { job } = w.readyJob();
    w.addEvent(job.id, null, "ASSIGNED", new Date("2026-10-30T04:30:00Z"));
    const r = await recordTuriaClose(job.id, { turiaTaskRef: "TT-4411", minutes: "90" }, send);
    expect(r).toEqual({ ok: true, done: true });
    const v = (await view(job.id))!;
    expect(v).toMatchObject({ state: "DONE", action: null, gate: null });
    const card = await status(v);
    expect(card).toContain(">DONE<");
    expect(card).toMatch(/Closed 05 Nov 2026 11:30 IST · cycle time 6d 1h/);
    const out = await bar(v);
    expect(out).toContain("Done: filed, Final file in SharePoint and the Turia task closed.");
    expect(out).not.toMatch(/<button/);
  });

  it("staff not on the job, a superseded run, or a job before approval: no action (and null before APPROVED)", async () => {
    const job = approvedJob();
    expect((await view(job.id, activeSession({ id: "u-other" }).user))!.action).toBeNull();
    expect((await view(job.id, priya().user, false))!.action).toBeNull();
    const idle = await bar((await view(job.id, activeSession({ id: "u-other" }).user))!);
    expect(idle).toContain("A person files it on the portal and records the acknowledgement.");
    expect(idle).not.toMatch(/<button/);
    const noFinal = await bar((await view(approvedJob("GST", false).id, activeSession({ id: "u-other" }).user))!);
    expect(noFinal).toContain("Pack approved; no Final file is recorded yet. A person files it on the portal");
    expect(await view(w.addJob({ state: "IN_REVIEW" }).id)).toBeNull();
    expect(await view("missing")).toBeNull();
  });
});

describe("panel calls through the routes (mocked call)", () => {
  it("Mark filed posts the ack ref, Turia ref and minutes to /filed", async () => {
    const job = approvedJob("ROC");
    const r = await recordFiling(job.id, ackRefFor("ROC"), { ackRef: "SRN-F12345678", turiaTaskRef: "TT-5", minutes: "30" }, send);
    expect(send).toHaveBeenCalledWith(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: "SRN-F12345678", turiaTaskRef: "TT-5", minutes: 30 });
    expect(r).toEqual({ ok: true, state: "CLOSING" });
    expect(w.job(job.id)).toMatchObject({ state: "CLOSING", ackRef: "SRN-F12345678", filedById: "u-priya" });
  });

  it("a missing required ack ref never reaches the route", async () => {
    const job = approvedJob("IncomeTax");
    expect(await recordFiling(job.id, ackRefFor("IncomeTax"), { ackRef: "", turiaTaskRef: "", minutes: "" }, send)).toMatchObject({ ok: false, error: expect.stringMatching(/ITR acknowledgement no\./) });
    expect(send).not.toHaveBeenCalled();
    expect(w.job(job.id).state).toBe("APPROVED");
  });

  it("staff without access get the route's 403 message; nothing changes", async () => {
    const job = approvedJob();
    signedIn(activeSession({ id: "u-other" }));
    const r = await recordFiling(job.id, ackRefFor("GST"), { ackRef: "AA1", turiaTaskRef: "", minutes: "" }, send);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/assignee or reviewer, a manager or a partner/) });
    expect(await recordTuriaClose(job.id, { turiaTaskRef: "TT-1", minutes: "5" }, send)).toMatchObject({ ok: false, error: expect.stringMatching(/assignee or reviewer/) });
    expect(w.job(job.id).state).toBe("APPROVED");
  });

  it("golden path: Mark filed with ARN → Close in Turia with minutes → DONE", async () => {
    const job = approvedJob("GST");
    expect(await recordFiling(job.id, ackRefFor("GST"), { ackRef: "AA2710260012345", turiaTaskRef: "", minutes: "" }, send)).toEqual({ ok: true, state: "CLOSING" });
    expect(await recordTuriaClose(job.id, { turiaTaskRef: "TT-88", minutes: "45" }, send)).toEqual({ ok: true, done: true });
    expect(send).toHaveBeenLastCalledWith(`/api/firm-os/jobs/${job.id}/turia-close`, { turiaTaskRef: "TT-88", minutes: 45 });
    expect(w.job(job.id).state).toBe("DONE");
  });

  it("negative: filed but Turia skipped → stays CLOSING and DONE is refused", async () => {
    const job = approvedJob("GST");
    await recordFiling(job.id, ackRefFor("GST"), { ackRef: "AA2710260012345", turiaTaskRef: "", minutes: "" }, send);
    const done = await send(`/api/firm-os/jobs/${job.id}/state`, { to: "DONE", expectedState: "CLOSING" });
    expect(done).toMatchObject({ ok: false, error: expect.stringMatching(/only by the close gate/) });
    expect(w.job(job.id).state).toBe("CLOSING");
    const v = (await view(job.id))!;
    expect(v).toMatchObject({ state: "CLOSING", action: "turia-close", turia: { status: "none" } });
    expect(await status(v)).toContain("Not recorded yet");
  });
});

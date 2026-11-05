// Close gate integration tests (ADR-005): an in-memory database, a fake SharePoint and the real
// state machine. A job reaches DONE only with a live Final file AND a closed Turia task with time.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { transitionJobTask } from "@/lib/agents/core/state-db";
import { BlockedError } from "@/lib/integrations/sharepoint/errors";
import { CloseLoopWorld, sha } from "../../../tests/fakes/close-loop-world";
import type { CloseLoopDb } from "./db";
import {
  GATE_ACTOR_REF,
  canClose,
  checkTuria,
  closeJob,
  finalFolder,
  isInFinalFolder,
  isSpotCheckSelected,
  parseGateEvidence,
  type GateEvidence,
} from "./gate";
import { graphDeliverableVerifier, type DeliverableVerifier } from "./verifier";

// Compile-time: the real Prisma client satisfies the narrow interface the close loop takes.
export const _prismaFits = (p: PrismaClient): CloseLoopDb => p;

const NOW = new Date("2026-11-02T05:00:00.000Z"); // 10:30 IST Mon
const now = () => NOW;
const staff = { kind: "human", userId: "u-priya", roles: ["staff"] } as const;

function setup() {
  const w = new CloseLoopWorld();
  w.clock = now;
  return { w, deps: { db: w.db, verifier: w.verifier, now } };
}

async function expectStaysClosing(w: CloseLoopWorld, jobId: string, deps: Parameters<typeof closeJob>[2], reason: RegExp) {
  const r = await closeJob(jobId, staff, deps);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons.join(" | ")).toMatch(reason);
  expect(w.job(jobId).state).toBe("CLOSING");
  expect(w.job(jobId).doneAt).toBeNull();
  expect(w.events.some((e) => e.jobTaskId === jobId && e.toState === "DONE")).toBe(false);
  expect(w.audits.at(-1)).toMatchObject({ action: "close-refused", entity: "JobTask", entityId: jobId, actorId: "u-priya" });
  return r;
}

describe("closeJob — both conditions present", () => {
  it("moves CLOSING → DONE as system:close-gate with the evidence in the event note", async () => {
    const { w, deps } = setup();
    const { job, deliverable, sync } = w.readyJob();
    const r = await closeJob(job.id, staff, deps);
    expect(r.ok).toBe(true);
    expect(w.job(job.id).state).toBe("DONE");
    expect(w.job(job.id).doneAt).toEqual(NOW);

    const ev = w.events.find((e) => e.jobTaskId === job.id && e.toState === "DONE")!;
    expect(ev).toMatchObject({ fromState: "CLOSING", actorId: GATE_ACTOR_REF });
    expect(GATE_ACTOR_REF).toBe("system:close-gate");
    const evidence = parseGateEvidence(ev.note)!;
    expect(evidence).not.toBeNull();
    expect(evidence.deliverables).toEqual([
      { id: deliverable.id, name: deliverable.name, driveItemId: deliverable.driveItemId, sha256: deliverable.sha256, sizeBytes: deliverable.sizeBytes, path: `FY2026-27/GST/2026-10/Final/${deliverable.name}` },
    ]);
    expect(evidence.turia).toMatchObject({ syncId: sync.id, turiaRef: "TT-4411", minutesLogged: 90, mode: "MANUAL" });
    expect(evidence.filing).toMatchObject({ filedById: "u-priya", ackRef: "AA2710260012345" });
    expect(evidence.checkedAt).toBe(NOW.toISOString());

    expect(w.deliverables[0].verifiedAt).toEqual(NOW);
    expect(w.audits.find((a) => a.action === "close")).toMatchObject({ actorId: "u-priya", entityId: job.id });
    expect(w.transactions).toBe(1);
  });

  it("a second attempt on a DONE job is refused and writes no second DONE event", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    await closeJob(job.id, staff, deps);
    const r = await closeJob(job.id, staff, deps);
    expect(r).toMatchObject({ ok: false, state: "DONE" });
    expect(w.events.filter((e) => e.toState === "DONE")).toHaveLength(1);
    expect(w.audits.map((a) => a.action)).toEqual(["close", "close-refused"]);
  });

  it("uses the drive's sha256 when reported and does not download", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { reportSha: true });
    w.addCloseSync(job.id);
    expect((await closeJob(job.id, staff, deps)).ok).toBe(true);
    expect(w.verifierCalls.download).toBe(0);
  });

  it("one good Final file is enough; the evidence lists only verified files", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { name: "old_v1.xlsx", inSharePoint: false });
    const good = w.addFinal(job, { name: "pack_v2.xlsx" });
    w.addCloseSync(job.id);
    const r = await closeJob(job.id, staff, deps);
    expect(r.ok && r.evidence.deliverables.map((d) => d.id)).toEqual([good.id]);
  });

  it("services without an acknowledgement (Books) close without an ack ref", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob({ service: "Books", ackRef: null, title: "Books close" });
    expect((await closeJob(job.id, staff, deps)).ok).toBe(true);
  });
});

describe("closeJob — SharePoint condition (a) unmet: job stays CLOSING", () => {
  it("missing SharePoint file", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { inSharePoint: false });
    w.addCloseSync(job.id);
    const r = await expectStaysClosing(w, job.id, deps, /not found in SharePoint/);
    expect(r.ok).toBe(false);
  });

  it("no Final deliverable recorded at all", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /No Final deliverable/);
  });

  it("a Working (not Final) deliverable does not count", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { kind: "Working" });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /No Final deliverable/);
  });

  it("file recorded at the wrong path (Working folder)", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { spPath: "/sites/CL-ACME01/Compliance/FY2026-27/GST/2026-10/Working" });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /not in \/sites\/CL-ACME01\/Compliance\/FY2026-27\/GST\/2026-10\/Final/);
  });

  it("file recorded in another client's / period's Final folder", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { spPath: "/sites/CL-ACME01/Compliance/FY2026-27/GST/2026-09/Final" });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /not in/);
  });

  it("file live in SharePoint but moved out of the Final folder", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { livePath: "FY2026-27/GST/2026-10/Working/ACME01_GSTR-3B_2026-10_v1.xlsx" });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /not inside/);
  });

  it("a different item sits at the expected path", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    const verifier: DeliverableVerifier = {
      getItem: async (ref) => ({ exists: true, driveItemId: "someone-elses-item", sizeBytes: 10, path: ref.path, sha256: null }),
      download: async () => new Uint8Array([1]),
    };
    await expectStaysClosing(w, job.id, { ...deps, verifier }, /different file/);
  });

  it("sha256 mismatch (file overwritten after upload)", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { liveBytes: new TextEncoder().encode("edited by hand") });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /SHA-256 does not match/);
  });

  it("sha256 mismatch reported by the drive", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { liveBytes: new TextEncoder().encode("other"), reportSha: true });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /SHA-256 does not match/);
    expect(w.verifierCalls.download).toBe(0);
  });

  it("size 0", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { content: "", liveBytes: new Uint8Array() });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /empty \(0 bytes\)/);
  });

  it("no driveItemId recorded", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job, { driveItemId: null });
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /no SharePoint item id/);
  });

  it("the file cannot be downloaded", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    const verifier: DeliverableVerifier = { getItem: w.verifier.getItem, download: async () => null };
    await expectStaysClosing(w, job.id, { ...deps, verifier }, /could not be downloaded/);
  });

  it("Graph outage or missing credentials fails safe (BlockedError action surfaced)", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    w.verifierError = new BlockedError("Set MS_CLIENT_SECRET");
    const check = await canClose(job.id, deps);
    expect(check.missing).toEqual({ finalFile: true, turiaClose: false, filing: false });
    await expectStaysClosing(w, job.id, deps, /SharePoint check failed: Set MS_CLIENT_SECRET/);
    w.verifierError = new Error("ECONNRESET");
    await expectStaysClosing(w, job.id, deps, /ECONNRESET/);
  });

  it("the production Graph verifier is blocked on hashing until the Phase 4 merge: job stays CLOSING", async () => {
    const { w, deps } = setup();
    const { job, deliverable } = w.readyJob();
    const graph = {
      getSiteByUrl: async () => ({ id: "site-1", webUrl: "x" }),
      getDriveByName: async () => ({ id: "drive-acme", name: "Compliance" }),
      getItemByPath: async () => ({ id: deliverable.driveItemId!, name: deliverable.name, size: deliverable.sizeBytes }),
    };
    await expectStaysClosing(w, job.id, { ...deps, verifier: graphDeliverableVerifier(() => graph) }, /downloadFile/);
  });
});

describe("closeJob — Turia condition (b) unmet: job stays CLOSING", () => {
  it("Turia not closed (no close step at all)", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job);
    await expectStaysClosing(w, job.id, deps, /Turia task not closed/);
    expect((await canClose(job.id, deps)).missing).toEqual({ finalFile: false, turiaClose: true, filing: false });
  });

  it("checklist issued but not confirmed", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job);
    w.addCloseSync(job.id, { status: "CHECKLIST_ISSUED", turiaRef: null, minutesLogged: null });
    await expectStaysClosing(w, job.id, deps, /not confirmed yet \(checklist issued\)/);
  });

  it("minutes 0", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job);
    w.addCloseSync(job.id, { minutesLogged: 0 });
    await expectStaysClosing(w, job.id, deps, /no time logged/);
  });

  it("minutes missing on a CLOSED row", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job);
    w.addCloseSync(job.id, { minutesLogged: null });
    await expectStaysClosing(w, job.id, deps, /no time logged/);
  });

  it("checkTuria prefers any CLOSED row with minutes", () => {
    const base = { operation: "closeTask", mode: "MANUAL", confirmedById: null, spotChecked: false, updatedAt: NOW };
    const r = checkTuria([
      { ...base, id: "a", status: "FAILED", turiaRef: null, minutesLogged: null },
      { ...base, id: "b", status: "CLOSED", turiaRef: "T-1", minutesLogged: 30 },
    ]);
    expect(r.ok && r.sync.id).toBe("b");
  });
});

describe("closeJob — filing condition (c) and state", () => {
  it("not CLOSING yet (FILED_BY_HUMAN) stays put", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    w.addEvent(job.id, "APPROVED", "FILED_BY_HUMAN", new Date("2026-11-02T04:30:00Z"));
    w.addFinal(job);
    w.addCloseSync(job.id);
    const r = await closeJob(job.id, staff, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/only a CLOSING job/);
    expect(w.job(job.id).state).toBe("FILED_BY_HUMAN");
  });

  it("no filing confirmation event", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFinal(job);
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /No filing confirmation/);
  });

  it("filed again after the last start-closing (history out of order)", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addEvent(job.id, "FILED_BY_HUMAN", "CLOSING", new Date("2026-11-02T04:00:00Z"));
    w.addEvent(job.id, "APPROVED", "FILED_BY_HUMAN", new Date("2026-11-02T04:30:00Z"));
    w.addFinal(job);
    w.addCloseSync(job.id);
    await expectStaysClosing(w, job.id, deps, /not moved to closing/);
  });

  it("GST without an ARN", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob({ ackRef: null });
    await expectStaysClosing(w, job.id, deps, /acknowledgement reference/);
    expect((await canClose(job.id, deps)).missing.filing).toBe(true);
  });

  it("unknown job", async () => {
    const { deps, w } = setup();
    const r = await closeJob("nope", { kind: "system", name: "close-loop-reconciler" }, deps);
    expect(r).toEqual({ ok: false, state: null, reasons: ["Job nope not found"] });
    expect(w.audits[0]).toMatchObject({ action: "close-refused", actorId: "system:close-loop-reconciler" });
  });
});

describe("closeJob — transaction re-check", () => {
  it("refuses if the Turia close changes between the live check and the transaction", async () => {
    const { w, deps } = setup();
    const { job, sync } = w.readyJob();
    const verifier: DeliverableVerifier = {
      getItem: async (ref) => {
        const r = await w.verifier.getItem(ref);
        sync.minutesLogged = 5; // someone re-confirms with different minutes mid-check
        return r;
      },
      download: w.verifier.download,
    };
    await expectStaysClosing(w, job.id, { ...deps, verifier }, /Turia close changed/);
  });

  it("refuses if a deliverable row changes mid-check", async () => {
    const { w, deps } = setup();
    const { job, deliverable } = w.readyJob();
    const verifier: DeliverableVerifier = {
      getItem: w.verifier.getItem,
      download: async (ref) => {
        const b = await w.verifier.download(ref);
        deliverable.sha256 = sha("new");
        return b;
      },
    };
    await expectStaysClosing(w, job.id, { ...deps, verifier }, /deliverable record changed/);
  });

  it("refuses if the filing is retracted mid-check", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    const verifier: DeliverableVerifier = {
      getItem: async (ref) => {
        w.job(job.id).state = "APPROVED";
        return w.verifier.getItem(ref);
      },
      download: w.verifier.download,
    };
    const r = await closeJob(job.id, staff, { ...deps, verifier });
    expect(r).toMatchObject({ ok: false, state: "APPROVED" });
  });

  it("refuses if the ack ref changes mid-check", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    const verifier: DeliverableVerifier = {
      getItem: async (ref) => {
        w.job(job.id).ackRef = "OTHER";
        return w.verifier.getItem(ref);
      },
      download: w.verifier.download,
    };
    await expectStaysClosing(w, job.id, { ...deps, verifier }, /filing confirmation changed/);
  });
});

describe("DONE cannot be reached without the gate", () => {
  it("transitionJobTask to DONE without a token is refused for a partner too", async () => {
    const { w } = setup();
    const { job } = w.readyJob();
    const partner = { kind: "human", userId: "u-partner", roles: ["partner"] } as const;
    const r = await transitionJobTask(w.db, job.id, "DONE", partner, { expectedState: "CLOSING", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("a forged token-shaped object is refused", async () => {
    const { w } = setup();
    const { job } = w.readyJob();
    const forged = Object.freeze({ jobTaskId: job.id, mintedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000), evidence: {} });
    const r = await transitionJobTask(w.db, job.id, "DONE", { kind: "system", name: "close-gate" }, { expectedState: "CLOSING", now: NOW, gateToken: forged as never });
    expect(r).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
  });
});

describe("spot check", () => {
  it("is deterministic and selects about 10% of jobs", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `cjob${i}`);
    const picked = ids.filter(isSpotCheckSelected);
    expect(picked.length / ids.length).toBeGreaterThan(0.08);
    expect(picked.length / ids.length).toBeLessThan(0.12);
    expect(ids.filter(isSpotCheckSelected)).toEqual(picked);
  });

  it("a selected manual close is flagged but still reaches DONE", async () => {
    const id = Array.from({ length: 200 }, (_, i) => `job-sc-${i}`).find(isSpotCheckSelected)!;
    const { w, deps } = setup();
    w.readyJob({ id });
    const r = await closeJob(id, staff, deps);
    expect(r).toMatchObject({ ok: true, spotCheck: true });
    expect(w.audits.find((a) => a.action === "spot-check-selected")).toMatchObject({ entity: "TuriaSync", meta: { jobTaskId: id } });
  });

  it("an unselected job and a non-manual close are not flagged", async () => {
    const unselected = Array.from({ length: 50 }, (_, i) => `job-ns-${i}`).find((x) => !isSpotCheckSelected(x))!;
    const selected = Array.from({ length: 200 }, (_, i) => `job-api-${i}`).find(isSpotCheckSelected)!;
    const { w, deps } = setup();
    w.readyJob({ id: unselected });
    const j2 = w.addJob({ id: selected });
    w.addFiledHistory(j2.id);
    w.addFinal(j2);
    w.addCloseSync(j2.id, { mode: "API" });
    expect(await closeJob(unselected, staff, deps)).toMatchObject({ ok: true, spotCheck: false });
    expect(await closeJob(selected, staff, deps)).toMatchObject({ ok: true, spotCheck: false });
    expect(w.audits.some((a) => a.action === "spot-check-selected")).toBe(false);
  });
});

describe("path rules", () => {
  const job = { fy: "2026-27", service: "GST" as const, period: "2026-10", firmClient: { clientCode: "ACME01" } };
  const folder = (finalFolder(job) as { ok: true; folder: Parameters<typeof isInFinalFolder>[1] }).folder;

  it("accepts the folder or folder + file name, case-insensitively", () => {
    expect(isInFinalFolder({ spPath: folder.serverRelativeUrl, name: "a.xlsx" }, folder)).toBe(true);
    expect(isInFinalFolder({ spPath: `${folder.serverRelativeUrl}/a.xlsx`, name: "a.xlsx" }, folder)).toBe(true);
    expect(isInFinalFolder({ spPath: folder.serverRelativeUrl.toLowerCase() + "/", name: "a.xlsx" }, folder)).toBe(true);
  });

  it("rejects subfolders, other files and bad names", () => {
    expect(isInFinalFolder({ spPath: `${folder.serverRelativeUrl}/sub`, name: "a.xlsx" }, folder)).toBe(false);
    expect(isInFinalFolder({ spPath: `${folder.serverRelativeUrl}/b.xlsx`, name: "a.xlsx" }, folder)).toBe(false);
    expect(isInFinalFolder({ spPath: folder.serverRelativeUrl, name: "../a.xlsx" }, folder)).toBe(false);
    expect(isInFinalFolder({ spPath: folder.serverRelativeUrl, name: ".." }, folder)).toBe(false);
    expect(isInFinalFolder({ spPath: folder.serverRelativeUrl, name: " " }, folder)).toBe(false);
  });

  it("a bad client code or period cannot produce a folder", async () => {
    expect(finalFolder({ ...job, firmClient: { clientCode: "acme" } })).toMatchObject({ ok: false });
    expect(finalFolder({ ...job, period: "2027-04" })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside FY2026-27/) });
    const { w, deps } = setup();
    const j = w.addJob({ clientCode: "bad" });
    w.addFiledHistory(j.id);
    w.addFinal({ ...j, clientCode: "ACME01" });
    w.addCloseSync(j.id);
    await expectStaysClosing(w, j.id, deps, /cannot be built/);
  });
});

describe("parseGateEvidence", () => {
  const good: GateEvidence = {
    gate: "close-gate",
    v: 1,
    checkedAt: NOW.toISOString(),
    deliverables: [{ id: "d", name: "n", driveItemId: "i", sha256: sha("x"), sizeBytes: 1, path: "p" }],
    turia: { syncId: "s", mode: "MANUAL", turiaRef: "T", minutesLogged: 5, confirmedById: "u", spotCheck: false },
    filing: { filedEventId: "e", closingEventId: "c", filedById: "u", filedAt: NOW.toISOString(), ackRef: null },
  };

  it("accepts complete evidence", () => {
    expect(parseGateEvidence(JSON.stringify(good))).toEqual(good);
  });

  it.each([
    ["null", null],
    ["not json", "closed by partner"],
    ["json null", "null"],
    ["other gate", JSON.stringify({ ...good, gate: "manual" })],
    ["no deliverables", JSON.stringify({ ...good, deliverables: [] })],
    ["bad sha", JSON.stringify({ ...good, deliverables: [{ ...good.deliverables[0], sha256: "abc" }] })],
    ["zero size", JSON.stringify({ ...good, deliverables: [{ ...good.deliverables[0], sizeBytes: 0 }] })],
    ["zero minutes", JSON.stringify({ ...good, turia: { ...good.turia, minutesLogged: 0 } })],
    ["no filing", JSON.stringify({ ...good, filing: undefined })],
  ])("rejects %s", (_n, note) => {
    expect(parseGateEvidence(note)).toBeNull();
  });
});

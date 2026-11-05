// Write-time masking of notes, comments and reasons (DPDP audit finding #5, "prevent new
// survivors"): what staff type is stored with the client's names and identifiers masked.
import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { addComment, approvePack, requestChanges, startAgentRun, submitForReview } from "@/lib/agents/service";
import { setJobState, type CloseLoopDeps } from "@/lib/close-loop/actions";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { echoWorld, rows, user } from "../../../tests/fakes/agent-world";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { clientDictionary, scrubFreeText } from "./mask";

describe("scrubFreeText with a client dictionary", () => {
  it("masks identifiers always, and the client's names when they are given", () => {
    const note = "Kiran Kumar says PAN ABCPK1234F is wrong; Kiran will call from 9876543210 (Kumar Traders)";
    expect(scrubFreeText(note)).toBe("Kiran Kumar says PAN ⟨PAN_1⟩ is wrong; Kiran will call from ⟨PHONE_1⟩ (Kumar Traders)");
    const dict = clientDictionary({ name: "Kumar Traders", contactName: "Kiran Kumar", entityType: "PROPRIETORSHIP" });
    expect(scrubFreeText(note, dict)).toBe("⟨NAME_1⟩ says PAN ⟨PAN_1⟩ is wrong; ⟨NAME_2⟩ will call from ⟨PHONE_1⟩ (⟨ORG_1⟩)");
  });

  it("builds the dictionary from client names only, null-safe, never from erased values", () => {
    expect(clientDictionary(null, undefined)).toEqual([]);
    expect(clientDictionary({ name: "[erased] c-1", contactName: null })).toEqual([]);
    expect(clientDictionary({ name: "Lalitha Rao", entityType: "INDIVIDUAL" })).toEqual([
      { value: "Lalitha Rao", kind: "NAME" },
      { value: "Lalitha", kind: "NAME" },
      { value: "Rao", kind: "NAME" },
    ]);
  });
});

describe("agent comments and review notes are stored masked", () => {
  const RAW = "Acme Pvt Ltd: PAN ABCDE1234F on page 2, call 9876543210";

  it("a comment keeps no client name or identifier", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    expect(await addComment(user("ravi"), "run-1", RAW, w.deps)).toMatchObject({ ok: true });
    const ev = rows(w.db, "auditEvent").find((e) => e.action === "comment");
    expect(ev?.meta).toEqual({ text: "⟨ORG_1⟩: PAN ⟨PAN_1⟩ on page 2, call ⟨PHONE_1⟩" });
  });

  it("a change request's note is masked on the job history, the old run and the audit; approval notes too", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    await submitForReview(user("priya"), "run-1", w.deps);
    expect(await requestChanges(user("ravi"), "run-1", RAW, w.deps)).toMatchObject({ ok: true });
    const stored = "⟨ORG_1⟩: PAN ⟨PAN_1⟩ on page 2, call ⟨PHONE_1⟩";
    expect(rows(w.db, "jobTaskEvent").find((e) => e.toState === "IN_PREP" && e.fromState === "IN_REVIEW")?.note).toBe(stored);
    expect(rows(w.db, "agentRun").find((r) => r.id === "run-1")).toMatchObject({ status: "CHANGES_REQUESTED", reviewNotes: stored });
    expect(rows(w.db, "auditEvent").find((e) => e.action === "request-changes")?.meta).toMatchObject({ note: stored });

    await submitForReview(user("priya"), "run-2", w.deps);
    expect(await approvePack(user("ravi"), "run-2", "Fine. Acme Pvt Ltd confirmed by mail", w.deps)).toMatchObject({ ok: true });
    expect(rows(w.db, "auditEvent").find((e) => e.action === "approve")?.meta).toMatchObject({ note: "Fine. ⟨ORG_1⟩ confirmed by mail" });
    expect(JSON.stringify(rows(w.db, "auditEvent"))).not.toMatch(/ABCDE1234F|9876543210|Acme Pvt Ltd/);
  });

  it("a close-loop transition note (e.g. a retracted filing) is stored with identifiers masked", async () => {
    const w = new CloseLoopWorld();
    const NOW = new Date("2026-11-02T05:00:00.000Z");
    w.clock = () => NOW;
    const manual = new ManualBridge(w.turiaRepo, () => NOW);
    const deps: CloseLoopDeps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal: async () => ({ copied: 0 }), now: () => NOW };
    const manager = { id: "u-mgr", name: "m", email: "m@x", image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "MANAGER" } as unknown as Session["user"];
    const job = w.addJob({ state: "IN_REVIEW" });
    await setJobState(job.id, { to: "IN_PREP", expectedState: "IN_REVIEW", note: "GSTIN 29ABCPK1234F1Z5 is wrong, mail kiran@kumar.test" }, manager, deps);
    const masked = "GSTIN ⟨GSTIN_1⟩ is wrong, mail ⟨EMAIL_1⟩";
    expect(w.events.at(-1)?.note).toBe(masked);
    expect(w.audits.at(-1)?.meta).toMatchObject({ note: masked });
  });
});

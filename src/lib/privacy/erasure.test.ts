import { describe, expect, it } from "vitest";
import { confirmErasure, planErasure, publicPlan, type ErasurePlan } from "./erasure";
import { isAiProcessingRestricted, processingRestrictions } from "./consent";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import { SELF_ERASURE_MESSAGE } from "./duties";
import type { PrivacyDb } from "./inventory";
import { PAN_PROP, SUPPLIER_PAN, T0, USERS, privacyWorld, sessionUser } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

type Row = Record<string, unknown>;
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const find = (db: MemoryDb, model: string, id: string) => db.tables[model].find((r) => r.id === id) as Row;

/** Logged by the admin, identity checked by the partner (separation of duties: src/lib/privacy/duties.ts). */
async function erasureRequest(db: MemoryDb, identifiers: Record<string, string>, verify = true) {
  const r = await createRequest(USERS.admin, { kind: "erasure", identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  if (verify) await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
  return r.data.id;
}

const byKey = (plan: ErasurePlan | null) => Object.fromEntries((plan?.items ?? []).map((i) => [i.key, i]));

describe("erasure plan: anonymise or hold, per item", () => {
  it("holds an active GST client's records under the duties in force, and anonymises derived copies", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { pan: PAN_PROP });
    const plan = await planErasure(pdb(db), id, T0);
    const items = byKey(plan);

    const identity = items["client-identity:c-prop"];
    expect(identity).toMatchObject({ action: "hold", holdUntil: "2035-03-31T18:30:00.000Z", holdUntilLabel: "Until the engagement ends, and at least until 01 Apr 2035" });
    expect(identity.basis.map((b: { id: string }) => b.id)).toEqual(["active-engagement", "gst", "icai"]);
    expect(identity.basis.find((b: { id: string }) => b.id === "gst")?.holdUntil).toBe("2033-12-31T18:30:00.000Z"); // 01 Jan 2034 IST
    for (const b of identity.basis) expect(b.verify.length).toBeGreaterThan(20);

    expect(items["client-contact:c-prop"]).toMatchObject({ action: "hold", holdUntil: null, holdUntilLabel: "Until the engagement ends" });
    expect(items["legacy-jobs:lj-prop"].action).toBe("hold");
    expect(items["deliverables:dl-prop"].action).toBe("hold");
    expect(items["client-documents:doc-prop"].action).toBe("hold");
    expect(items["certificates:cert-prop"].action).toBe("hold");
    expect(items["comms-drafts:d-new"]).toMatchObject({ action: "anonymise", fields: ["subject", "body"] });
    expect(items["onboarding-runs:ob-prop"]).toMatchObject({ action: "anonymise", fields: ["prompt", "spec", "plan"] });
    expect(items["agent-runs:run-prop"]).toMatchObject({ action: "anonymise", fields: ["inputs"] });
    expect(items["agent-runs:run-prop"].consequence).toMatch(/^Cached inputs will be replaced .* This can't be undone\.$/);
    expect(items["external:turia:c-prop"].action).toBe("manual");
    expect(items["external:sharepoint:c-prop"].action).toBe("manual");
    expect(plan?.items.filter((i) => i.action === "keep").map((i) => i.dataset)).toEqual(["firm-client", "engagements", "audit-log"]);
    expect(plan?.counts).toEqual({ anonymise: 4, hold: 6, keep: 3, manual: 2 });
    // Jobs without an acknowledgement reference have nothing personal to anonymise.
    expect(Object.keys(items).some((k) => k.startsWith("job-tasks:"))).toBe(false);
    // The preview never carries the column values.
    expect(publicPlan(plan!).items.every((i) => i.set === undefined)).toBe(true);
  });

  it("anonymises everything for a prospect with no engagement and no retention duty", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { email: "lalitha@consult.test" });
    const plan = await planErasure(pdb(db), id, T0);
    expect(plan?.items.map((i) => [i.dataset, i.action])).toEqual([
      ["client-identity", "anonymise"],
      ["client-contact", "anonymise"],
      ["audit-log", "keep"],
    ]);
  });

  it("anonymises an old client once every retention period has run out", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { pan: "DEFPO1111A" });
    const items = byKey(await planErasure(pdb(db), id, T0));
    expect(items["client-identity:c-old"].action).toBe("anonymise");
    expect(items["job-tasks:j-old"]).toMatchObject({ action: "anonymise", fields: ["ackRef"] });
    // The same client inside the Income-tax period would be held.
    const earlier = byKey(await planErasure(pdb(db), id, new Date("2022-06-01T00:00:00.000Z")));
    expect(earlier["client-identity:c-old"]).toMatchObject({ action: "hold", holdUntilLabel: "Until 01 Apr 2024" });
    expect(earlier["client-identity:c-old"].basis.map((b: { id: string }) => b.id)).toEqual(["income-tax", "icai"]);
  });

  it("holds a staff member's records while they are employed", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { email: "priya@indefine.test" });
    const items = byKey(await planErasure(pdb(db), id, T0));
    expect(items[`staff-profile:${USERS.staff.id}`]).toMatchObject({ action: "hold", holdUntilLabel: "Until the person leaves the firm" });
  });
});

describe("confirming an erasure", () => {
  it("anonymises with UPDATEs only, records each item, and never removes a row", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { email: "lalitha@consult.test" });
    const plan = (await planErasure(pdb(db), id, T0))!;
    const sizes = Object.fromEntries(Object.entries(db.tables).map(([k, v]) => [k, v.length]));
    const before = db.calls.length;

    const r = await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db));
    expect(r).toMatchObject({ ok: true, data: { status: "COMPLETED", legalHold: null } });

    const prospect = find(db, "client", "c-prospect");
    expect(prospect).toMatchObject({
      id: "c-prospect",
      name: "[erased] c-prospect",
      folderName: "[erased] c-prospect",
      pan: null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      growthNote: null,
      city: null,
      active: false,
      turnover: 0,
      entityType: "INDIVIDUAL",
    });
    const calls = db.calls.slice(before);
    expect(removalCalls(db.calls)).toEqual([]);
    for (const c of calls) expect(c === "$transaction" || /\.(findUnique|findFirst|findMany|count|create|update)$/.test(c)).toBe(true);
    expect(calls).toContain("client.update");
    for (const [model, n] of Object.entries(sizes)) if (model !== "auditEvent") expect(db.tables[model].length).toBe(n);

    const anon = db.tables.auditEvent.filter((e) => e.action === "anonymise");
    expect(anon.map((e) => [e.entity, e.entityId])).toEqual([
      ["Client", "c-prospect"],
      ["Client", "c-prospect"],
    ]);
    expect(JSON.stringify(db.tables.auditEvent)).not.toMatch(/Lalitha|lalitha@|9000012345/);
    expect(find(db, "privacyRequest", id)).toMatchObject({ status: "COMPLETED", outcome: expect.stringMatching(/^2 items anonymised, 0 on legal hold/) });
  });

  it("places legal holds with basis and date, anonymises the rest, and restricts processing of the held client", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { pan: PAN_PROP });
    const plan = (await planErasure(pdb(db), id, T0))!;
    const r = await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("ON_HOLD");
    expect(r.data.legalHold).toBe("Active engagement until the engagement ends; GST record keeping until 01 Jan 2034; ICAI working papers until 01 Apr 2035");

    expect(find(db, "client", "c-prop")).toMatchObject({ pan: PAN_PROP, contactPhone: "9876543210", name: "Kumar Traders" });
    expect(find(db, "commsDraft", "d-new")).toMatchObject({ subject: "[erased]", body: "[erased]", firmClientId: "fc-prop" });
    expect(find(db, "onboardingRun", "ob-prop")).toMatchObject({ prompt: "[erased]", spec: { erased: true }, plan: { erased: true } });
    expect(JSON.stringify(find(db, "agentRun", "run-prop").inputs ?? null)).not.toContain(SUPPLIER_PAN);
    expect(find(db, "agentRun", "run-prop").figures).toEqual({ outputTax: 1800 });

    const hold = db.tables.auditEvent.find((e) => e.action === "legal-hold" && e.entityId === "c-prop" && e.entity === "Client");
    expect(hold?.meta).toMatchObject({ basis: ["active-engagement", "gst", "icai"], holdUntil: "2035-03-31T18:30:00.000Z", privacyRequestId: id });
    expect(db.tables.auditEvent.filter((e) => e.action === "erasure-manual-step").map((e) => (e.meta as Row).system)).toEqual(["turia", "sharepoint"]);
    expect(await processingRestrictions(pdb(db), { entity: "Client", entityId: "c-prop" })).toEqual(["ai-processing", "comms-drafts", "marketing"]);
    expect(await isAiProcessingRestricted(pdb(db), "fc-prop")).toBe(true);
    expect(await isAiProcessingRestricted(pdb(db), "fc-co")).toBe(false);
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("refuses when the plan changed, when identity is not verified, for other kinds and for non-deciders", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { email: "lalitha@consult.test" });
    const plan = (await planErasure(pdb(db), id, T0))!;
    const stale = await confirmErasure(USERS.admin, id, { fingerprint: "0".repeat(64) }, deps(db));
    expect(stale).toMatchObject({ ok: false, status: 409, error: "The records changed after the plan was shown. Review the new plan and confirm again." });
    expect(find(db, "client", "c-prospect").name).toBe("Lalitha Consulting");

    expect(await confirmErasure(USERS.manager, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: false, status: 403 });
    expect(await confirmErasure(USERS.admin, id, { fingerprint: "" }, deps(db))).toMatchObject({ ok: false, status: 400 });

    const unverified = await erasureRequest(db, { email: "lalitha@consult.test" }, false);
    const p2 = (await planErasure(pdb(db), unverified, T0))!;
    expect(await confirmErasure(USERS.admin, unverified, { fingerprint: p2.fingerprint }, deps(db))).toMatchObject({ ok: false, status: 409 });

    const access = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!access.ok) throw new Error("setup");
    expect(await confirmErasure(USERS.admin, access.data.id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: false, status: 409 });
    expect(await planErasure(pdb(db), "missing", T0)).toBeNull();
  });

  it("is confirmed by a partner or admin other than the person who verified the identity (audit finding #28)", async () => {
    const db = privacyWorld();
    const id = await erasureRequest(db, { email: "lalitha@consult.test" }); // verified by the partner
    const plan = (await planErasure(pdb(db), id, T0))!;
    expect(await confirmErasure(USERS.partner, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: false, status: 403, error: SELF_ERASURE_MESSAGE });
    expect(find(db, "client", "c-prospect").name).toBe("Lalitha Consulting");
    expect(db.tables.auditEvent.some((e) => e.action === "anonymise")).toBe(false);

    // A second admin who did not verify may confirm.
    const secondAdmin = sessionUser("u-admin2", { role: "ADMIN", name: "Arun Admin" });
    expect(await confirmErasure(secondAdmin, id, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true, data: { status: "COMPLETED" } });
    const confirmed = db.tables.auditEvent.find((e) => e.action === "erasure-confirmed" && e.entityId === id);
    const verified = db.tables.auditEvent.find((e) => e.action === "verify-identity" && e.entityId === id);
    expect([verified?.actorId, confirmed?.actorId]).toEqual([USERS.partner.id, "u-admin2"]);
  });
});

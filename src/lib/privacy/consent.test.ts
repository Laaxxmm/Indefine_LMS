import { describe, expect, it } from "vitest";
import { activeRestrictionsOf, isAiProcessingRestricted, isCommsDraftingRestricted, liftRestriction, processingRestrictions, withdrawConsent } from "./consent";
import { correctForRequest } from "./correction";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import type { CorrectionsDb } from "@/lib/corrections/service";
import { PAN_PROP, T0, USERS, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

type Row = Record<string, unknown>;
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });

async function verified(db: MemoryDb, kind: string, identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  await verifyIdentity(USERS.admin, r.data.id, { method: "Reply from the email address on record" }, deps(db));
  return r.data.id;
}

describe("consent withdrawal", () => {
  it("marks processing restrictions for the client and says what they stop", async () => {
    const db = privacyWorld();
    const id = await verified(db, "consent-withdrawal", { pan: PAN_PROP });
    const r = await withdrawConsent(USERS.partner, id, deps(db));
    expect(r).toMatchObject({ ok: true, data: { restricted: 1, restrictions: ["No new AI processing", "No new message drafts", "No growth or marketing use"] } });
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, "fc-prop")).toBe(true);
    const request = db.tables.privacyRequest.find((x) => x.id === id) as Row;
    expect(request.status).toBe("COMPLETED");
    expect(String(request.outcome)).toMatch(/does not stop work the person engaged the firm for/);
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("switches off break nudges for a staff member (creating or updating the preference)", async () => {
    const db = privacyWorld();
    const id = await verified(db, "consent-withdrawal", { email: "priya@indefine.test" });
    await withdrawConsent(USERS.admin, id, deps(db));
    expect(db.tables.coachPreference.find((p) => p.userId === USERS.staff.id)).toMatchObject({ breakNudges: false });
    expect(await processingRestrictions(db as unknown as PrivacyDb, { entity: "User", entityId: USERS.staff.id })).toEqual(["coach-activity", "ai-processing"]);

    db.seed("coachPreference", [{ userId: USERS.reviewer.id, breakNudges: true, morningBoard: true }]);
    const id2 = await verified(db, "consent-withdrawal", { email: "ravi@indefine.test" });
    await withdrawConsent(USERS.admin, id2, deps(db));
    expect(db.tables.coachPreference.filter((p) => p.userId === USERS.reviewer.id)).toEqual([expect.objectContaining({ breakNudges: false, morningBoard: true })]);
  });

  it("needs a verified request of the right kind with someone to restrict", async () => {
    const db = privacyWorld();
    const r = await createRequest(USERS.admin, { kind: "consent-withdrawal", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error("setup");
    expect(await withdrawConsent(USERS.admin, r.data.id, deps(db))).toMatchObject({ ok: false, status: 409 });
    const nobody = await verified(db, "consent-withdrawal", { email: "nobody@nowhere.test" });
    const none = await withdrawConsent(USERS.admin, nobody, deps(db));
    expect(none).toMatchObject({ ok: false, status: 409 });
    if (!none.ok) expect(none.error).toMatch(/nothing to restrict/);
    const access = await verified(db, "access", { pan: PAN_PROP });
    expect(await withdrawConsent(USERS.admin, access, deps(db))).toMatchObject({ ok: false, status: 409 });
    expect(await withdrawConsent(USERS.staff, access, deps(db))).toMatchObject({ ok: false, status: 403 });
  });
});

describe("lifting a restriction (partner only, with a reason)", () => {
  async function withdrawn(db: MemoryDb) {
    const id = await verified(db, "consent-withdrawal", { pan: PAN_PROP });
    const r = await withdrawConsent(USERS.partner, id, deps(db));
    if (!r.ok) throw new Error(r.error);
    return id;
  }

  it("a partner lifts it with a reason: one lift event per record and one on the request; AI processing and drafts resume; nothing removed", async () => {
    const db = privacyWorld();
    const id = await withdrawn(db);
    expect(await activeRestrictionsOf(db as unknown as PrivacyDb, id)).toEqual([
      { entity: "Client", entityId: "c-prop", keys: ["ai-processing", "comms-drafts", "marketing"], labels: ["No new AI processing", "No new message drafts", "No growth or marketing use"] },
    ]);
    const r = await liftRestriction(USERS.partner, id, { reason: "Client gave written consent again on 05 Nov 2026" }, deps(db));
    expect(r).toEqual({ ok: true, data: { lifted: 1, restrictions: ["No new AI processing", "No new message drafts", "No growth or marketing use"] } });
    const lifts = db.tables.auditEvent.filter((e) => e.action === "lift-restriction");
    expect(lifts.map((e) => [e.entity, e.entityId, e.actorId])).toEqual([
      ["Client", "c-prop", USERS.partner.id],
      ["PrivacyRequest", id, USERS.partner.id],
    ]);
    expect(lifts[0].meta).toMatchObject({ privacyRequestId: id, reason: "Client gave written consent again on 05 Nov 2026" });
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, "fc-prop")).toBe(false);
    expect(await isCommsDraftingRestricted(db as unknown as PrivacyDb, "fc-prop")).toBe(false);
    expect(await activeRestrictionsOf(db as unknown as PrivacyDb, id)).toEqual([]);
    expect(db.tables.auditEvent.filter((e) => e.action === "restrict-processing")).toHaveLength(2); // the record of the restriction stays
    expect(removalCalls(db.calls)).toEqual([]);
    // The request's timeline says who lifted it and why.
    const { getRequest } = await import("./register");
    const d = await getRequest(db as unknown as PrivacyDb, id, T0);
    expect(d?.timeline.at(-1)).toMatchObject({ label: "Restriction lifted by a partner", detail: "Reason: Client gave written consent again on 05 Nov 2026" });
    // Nothing left to lift.
    expect(await liftRestriction(USERS.partner, id, { reason: "Client gave written consent again" }, deps(db))).toMatchObject({ ok: false, status: 409 });
  });

  it("admins, managers and staff cannot lift it; a reason is required; only consent withdrawals and erasure holds have one", async () => {
    const db = privacyWorld();
    const id = await withdrawn(db);
    const admin = await liftRestriction(USERS.admin, id, { reason: "Client gave written consent again" }, deps(db));
    expect(admin).toMatchObject({ ok: false, status: 403 });
    if (!admin.ok) expect(admin.error).toBe("Only a partner can lift a processing restriction. Ask a partner to review this request.");
    expect(await liftRestriction(USERS.staff, id, { reason: "Client gave written consent again" }, deps(db))).toMatchObject({ ok: false, status: 403 });
    expect(await liftRestriction(null, id, { reason: "Client gave written consent again" }, deps(db))).toMatchObject({ ok: false, status: 401 });
    const short = await liftRestriction(USERS.partner, id, { reason: "ok" }, deps(db));
    expect(short).toMatchObject({ ok: false, status: 400 });
    if (!short.ok) expect(short.error).toMatch(/Write why the restriction can be lifted/);
    expect(await liftRestriction(USERS.partner, "nope", { reason: "Client gave written consent again" }, deps(db))).toMatchObject({ ok: false, status: 404 });
    const access = await verified(db, "access", { pan: PAN_PROP });
    expect(await liftRestriction(USERS.partner, access, { reason: "Client gave written consent again" }, deps(db))).toMatchObject({ ok: false, status: 409 });
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, "fc-prop")).toBe(true);
    expect(db.tables.auditEvent.filter((e) => e.action === "lift-restriction")).toEqual([]);
  });

  it("a restriction from another request on the same client stays in force when one request's restriction is lifted", async () => {
    const db = privacyWorld();
    const first = await withdrawn(db);
    const second = await withdrawn(db);
    await liftRestriction(USERS.partner, first, { reason: "Consent given again for the first request" }, deps(db));
    expect(await processingRestrictions(db as unknown as PrivacyDb, { entity: "Client", entityId: "c-prop" })).toEqual(["ai-processing", "comms-drafts", "marketing"]);
    await liftRestriction(USERS.partner, second, { reason: "Consent given again for the second request" }, deps(db));
    expect(await processingRestrictions(db as unknown as PrivacyDb, { entity: "Client", entityId: "c-prop" })).toEqual([]);
  });

  it("isAiProcessingRestricted takes the LMS client id directly too", async () => {
    const db = privacyWorld();
    await withdrawn(db);
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, { lmsClientId: "c-prop" })).toBe(true);
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, { lmsClientId: "c-co" })).toBe(false);
    expect(await isAiProcessingRestricted(db as unknown as PrivacyDb, "fc-missing")).toBe(false);
  });
});

describe("correction requests route into the corrections service", () => {
  const cdeps = (db: MemoryDb) => ({ ...deps(db), corrections: { db: db as unknown as CorrectionsDb } });

  it("corrects the person's own client record, with the request id in both audits", async () => {
    const db = privacyWorld();
    const id = await verified(db, "correction", { pan: PAN_PROP });
    const r = await correctForRequest(USERS.admin, id, { entity: "Client", id: "c-prop", field: "contactEmail", newValue: "kiran.k@kumartraders.test", reason: "Client asked us to update it" }, cdeps(db));
    expect(r.ok).toBe(true);
    expect(db.tables.client.find((c) => c.id === "c-prop")?.contactEmail).toBe("kiran.k@kumartraders.test");
    const audits = db.tables.auditEvent.filter((e) => e.action === "correct");
    expect(audits.map((e) => e.entity)).toEqual(["Client", "PrivacyRequest"]);
    expect(audits[0].meta).toMatchObject({ privacyRequestId: id, before: "****test" });
  });

  it("refuses other people's records, invalid values (reused validation) and unverified requests", async () => {
    const db = privacyWorld();
    const id = await verified(db, "correction", { pan: PAN_PROP });
    expect(await correctForRequest(USERS.admin, id, { entity: "Client", id: "c-co", field: "city", newValue: "Hubballi", reason: "Client asked us" }, cdeps(db))).toMatchObject({ ok: false, status: 403 });
    expect(await correctForRequest(USERS.admin, id, { entity: "JobTask", id: "j-assigned", field: "title", newValue: "X", reason: "Client asked us" }, cdeps(db))).toMatchObject({ ok: false, status: 403 });
    const bad = await correctForRequest(USERS.admin, id, { entity: "Client", id: "c-prop", field: "pan", newValue: "NOTAPAN", reason: "Client asked us" }, cdeps(db));
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(await correctForRequest(USERS.admin, id, { entity: "FirmClient", id: "fc-prop", field: "preferredLanguage", newValue: "kn", reason: "Client prefers Kannada" }, cdeps(db))).toMatchObject({ ok: true });

    const r = await createRequest(USERS.admin, { kind: "correction", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error("setup");
    expect(await correctForRequest(USERS.admin, r.data.id, { entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Client asked us" }, cdeps(db))).toMatchObject({ ok: false, status: 409 });
    const staff = await verified(db, "correction", { email: "priya@indefine.test" });
    const s = await correctForRequest(USERS.admin, staff, { entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Client asked us" }, cdeps(db));
    expect(s).toMatchObject({ ok: false, status: 409 });
    if (!s.ok) expect(s.error).toMatch(/Team & hierarchy/);
  });
});

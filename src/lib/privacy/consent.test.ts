import { describe, expect, it } from "vitest";
import { isAiProcessingRestricted, processingRestrictions, withdrawConsent } from "./consent";
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

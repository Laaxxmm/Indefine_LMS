// The single-principal rule, shared by export, erasure and close (register.ts resolutionOf):
//   one client               → resolved to that client
//   several clients          → parked until a person chooses (even if an onboarding run also matches)
//   nothing anywhere         → refused (never "done" for nobody)
//   no client, but onboarding runs that hold exactly the request's identifiers → resolved to those
//                              rows ("identifier-only"): they can be exported, erased and the request
//                              closed; correction and restriction have no record to act on
import { describe, expect, it } from "vitest";
import { buildAccessExport, downloadAccessExport } from "./export";
import { confirmErasure, planErasure } from "./erasure";
import { withdrawConsent } from "./consent";
import { correctForRequest } from "./correction";
import { IDENTIFIER_ONLY_NO_RECORD, NOTHING_MATCHED, NOT_RESOLVED, closeRequest, createRequest, recordNomination, resolutionOf, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import type { CorrectionsDb } from "@/lib/corrections/service";
import { PAN_PROP, T0, USERS, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

const KEY = "k";
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: KEY });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const SHARED_PHONE = "9876543210"; // c-prop's contact phone; c-twin gets it too
const GHOST_PAN = "GHOPG9999G"; // on no client record, only in an abandoned onboarding

function world(): MemoryDb {
  const db = privacyWorld();
  const a = db.tables.client.find((c) => c.id === "c-prop")!;
  db.seed("client", [{ ...a, id: "c-twin", name: "Twin Stores", folderName: "Twin Stores", pan: "ABCPT1111K", gstin: null, contactEmail: "twin@stores.test" }]);
  db.seed("onboardingRun", [
    { id: "ob-ghost", createdById: USERS.partner.id, prompt: `Onboard Ghost Traders, PAN ${GHOST_PAN}`, spec: { legalName: "Ghost Traders", pan: GHOST_PAN }, plan: null, status: "FAILED", steps: null, error: null, firmClientId: null },
    { id: "ob-shared", createdById: USERS.partner.id, prompt: `Onboard someone, call ${SHARED_PHONE}`, spec: { contactPhone: SHARED_PHONE }, plan: null, status: "DRAFT", steps: null, error: null, firmClientId: null },
  ]);
  return db;
}

/** Logged by the admin, identity checked by the partner (duties.ts); the admin decides an erasure. */
async function verified(db: MemoryDb, kind: string, identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  const v = await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
  if (!v.ok) throw new Error(v.error);
  return r.data.id;
}
const REPLY = { outcome: "completed" as const, note: "Sent the reply with the export attached." };

describe("one client: resolved to that client", () => {
  it("exports, plans and closes for the one linked client", async () => {
    const db = world();
    const access = await verified(db, "access", { pan: PAN_PROP });
    expect(await resolutionOf(pdb(db), access, KEY)).toEqual({ kind: "principal", principal: { principalType: "client-person", ref: "c-prop" } });
    expect((await downloadAccessExport(USERS.admin, access, deps(db))).ok).toBe(true);
    expect((await closeRequest(USERS.admin, access, REPLY, deps(db))).ok).toBe(true);
    const erasure = await verified(db, "erasure", { pan: PAN_PROP });
    const plan = (await planErasure(pdb(db), erasure, T0, { hashKey: KEY }))!;
    expect(plan.items.some((i) => i.recordId === "c-prop")).toBe(true);
    // ob-shared holds c-prop's phone, but c-twin has the same phone: a shared identifier never pulls
    // in a row that is not linked to the client (it could be the other person's).
    expect(plan.items.some((i) => i.dataset === "onboarding-orphans")).toBe(false);
  });
});

describe("several clients: parked", () => {
  it("export, erasure and close are refused, even though an onboarding run also holds the phone", async () => {
    const db = world();
    const access = await verified(db, "access", { phone: SHARED_PHONE });
    expect(await resolutionOf(pdb(db), access, KEY)).toEqual({ kind: "parked", candidates: 2 });
    expect(await downloadAccessExport(USERS.admin, access, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });
    expect((await buildAccessExport(pdb(db), access, T0, KEY))?.datasets.every((d) => d.records.length === 0)).toBe(true);
    expect(await closeRequest(USERS.admin, access, REPLY, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });

    const erasure = await verified(db, "erasure", { phone: SHARED_PHONE });
    const plan = (await planErasure(pdb(db), erasure, T0, { hashKey: KEY }))!;
    expect(plan.items).toEqual([]);
    expect(await confirmErasure(USERS.admin, erasure, { fingerprint: plan.fingerprint }, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });
    expect(db.tables.onboardingRun.find((r) => r.id === "ob-shared")?.prompt).toContain(SHARED_PHONE);
    expect(removalCalls(db.calls)).toEqual([]);
  });
});

describe("nomination needs a resolved principal (like erasure and close)", () => {
  const NOMINEE = { nomineeName: "Meena Kumar", relationship: "spouse", nomineeContact: "9000011111" };
  it("refused when several people matched or nobody did; recorded for one client or identifier-only rows", async () => {
    const db = world();
    const several = await verified(db, "nomination", { phone: SHARED_PHONE });
    expect(await recordNomination(USERS.admin, several, NOMINEE, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });
    const nobody = await verified(db, "nomination", { email: "nobody@nowhere.test" });
    expect(await recordNomination(USERS.admin, nobody, NOMINEE, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    for (const id of [several, nobody]) {
      const row = db.tables.privacyRequest.find((r) => r.id === id)!;
      expect(row.status).not.toBe("COMPLETED");
      expect(String(row.notes ?? "")).not.toContain("Meena");
    }
    expect(db.tables.auditEvent.filter((e) => e.action === "nominate")).toEqual([]);
    const one = await verified(db, "nomination", { pan: PAN_PROP });
    expect(await recordNomination(USERS.admin, one, NOMINEE, deps(db))).toEqual({ ok: true, data: { id: one } });
    const ghost = await verified(db, "nomination", { pan: GHOST_PAN });
    expect((await recordNomination(USERS.admin, ghost, NOMINEE, deps(db))).ok).toBe(true);
  });
});

describe("nothing anywhere: refused", () => {
  it("export, erasure and close as done are refused; refusing with a reason still works", async () => {
    const db = world();
    const access = await verified(db, "access", { email: "nobody@nowhere.test" });
    expect(await resolutionOf(pdb(db), access, KEY)).toEqual({ kind: "nothing" });
    expect(await downloadAccessExport(USERS.admin, access, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    expect(await closeRequest(USERS.admin, access, REPLY, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    expect((await closeRequest(USERS.admin, access, { outcome: "rejected", note: "We found no record of you; please send another identifier." }, deps(db))).ok).toBe(true);

    const erasure = await verified(db, "erasure", { email: "nobody@nowhere.test" });
    const plan = (await planErasure(pdb(db), erasure, T0, { hashKey: KEY }))!;
    expect(plan.items).toEqual([]);
    expect(await confirmErasure(USERS.admin, erasure, { fingerprint: plan.fingerprint }, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
  });
});

describe("identifier-only: no client, but rows that hold exactly the request's identifiers", () => {
  it("resolves to those rows: the export lists them, the erasure erases them and completes, and the request can be closed", async () => {
    const db = world();
    const access = await verified(db, "access", { pan: GHOST_PAN });
    const res = await resolutionOf(pdb(db), access, KEY);
    expect(res.kind).toBe("identifier-only");
    if (res.kind === "identifier-only") expect(res.rows.map((r) => r.id)).toEqual(["ob-ghost"]);
    const download = await downloadAccessExport(USERS.admin, access, deps(db));
    expect(download.ok).toBe(true);
    if (download.ok) {
      expect(download.data.data.datasets.map((d) => [d.key, d.records.map((r) => r.id)])).toEqual([["onboarding-orphans", ["ob-ghost"]]]);
      expect(JSON.stringify(download.data.data)).toContain(GHOST_PAN);
      expect(download.data.data.notIncluded.some((n) => n.startsWith("Copies of the person's name or identifiers inside the firm's work records"))).toBe(true);
    }
    expect((await closeRequest(USERS.admin, access, REPLY, deps(db))).ok).toBe(true);

    const erasure = await verified(db, "erasure", { pan: GHOST_PAN });
    const plan = (await planErasure(pdb(db), erasure, T0, { hashKey: KEY }))!;
    expect(plan.items.map((i) => [i.dataset, i.action, i.records?.map((r) => r.id)])).toEqual([["onboarding-orphans", "anonymise", ["ob-ghost"]]]);
    expect(await confirmErasure(USERS.admin, erasure, { fingerprint: plan.fingerprint }, deps(db))).toMatchObject({ ok: true, data: { status: "COMPLETED" } });
    expect(db.tables.onboardingRun.find((r) => r.id === "ob-ghost")).toMatchObject({ prompt: "[erased]", spec: { erased: true }, status: "FAILED" });
    expect(db.tables.onboardingRun.find((r) => r.id === "ob-shared")?.prompt).toContain(SHARED_PHONE); // nobody else's run
    // Once erased, nothing of the person is left: a new request about them resolves to nothing.
    const again = await verified(db, "access", { pan: GHOST_PAN });
    expect(await resolutionOf(pdb(db), again, KEY)).toEqual({ kind: "nothing" });
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("correction and consent withdrawal have no record to act on, and say so", async () => {
    const db = world();
    const correction = await verified(db, "correction", { pan: GHOST_PAN });
    const c = await correctForRequest(USERS.admin, correction, { entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Client asked us" }, { ...deps(db), corrections: { db: db as unknown as CorrectionsDb } });
    expect(c).toEqual({ ok: false, status: 409, error: IDENTIFIER_ONLY_NO_RECORD });
    const consent = await verified(db, "consent-withdrawal", { pan: GHOST_PAN });
    expect(await withdrawConsent(USERS.admin, consent, deps(db))).toEqual({ ok: false, status: 409, error: IDENTIFIER_ONLY_NO_RECORD });
    expect(db.tables.client.find((x) => x.id === "c-prop")?.city).toBe("Bengaluru");
  });

  it("only a row holding every identifier the request was logged with counts; a different hash key finds nothing", async () => {
    const db = world();
    const both = await verified(db, "access", { pan: GHOST_PAN, email: "ghost@traders.test" }); // the run has the PAN, not this email
    expect(await resolutionOf(pdb(db), both, KEY)).toEqual({ kind: "nothing" });
    const pan = await verified(db, "access", { pan: GHOST_PAN });
    expect(await resolutionOf(pdb(db), pan, "another-key")).toEqual({ kind: "nothing" });
  });
});

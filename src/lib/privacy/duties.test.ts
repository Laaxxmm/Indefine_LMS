// Separation of duties on the privacy register (DPDP audit finding #28, ported from the audit PoC
// .audit-sec/dpdp/privacy-state-machine.test.ts: one admin logged, self-verified with "Other: trust
// me", exported and closed a request alone).
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/access";
import {
  OTHER_NOTE_MESSAGE,
  OTHER_VERIFY_NOTE_MIN,
  SELF_ERASURE_MESSAGE,
  SELF_VERIFY_MESSAGE,
  assertErasureDecider,
  assertNotCreator,
  verificationNoteProblem,
  verifierOf,
} from "./duties";
import { createRequest, step, verifyIdentity, type PrivacyDeps } from "./register";
import { fail } from "@/lib/corrections/result";
import type { PrivacyDb } from "./inventory";
import { PAN_PROP, T0, USERS, privacyWorld, sessionUser } from "./__tests__/fixtures";
import type { MemoryDb } from "./__tests__/memory-db";

const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });

/**
 * verifyIdentity() as it behaves once register.ts makes the two calls this module provides (the
 * note check before its step, assertNotCreator() inside it, right after loadOpen()).
 */
async function verifyWithDuties(user: SessionUser, id: string, input: { method: string; note?: string | null }, d: PrivacyDeps) {
  const problem = verificationNoteProblem(input.method, input.note);
  if (problem) return fail(400, problem);
  const gate = await step(d, (tx) => assertNotCreator(tx, id, user));
  if (!gate.ok) return gate;
  return verifyIdentity(user, id, input, d);
}

describe("verifying identity", () => {
  it("the person who logged the request cannot verify it; someone else can", async () => {
    const db = privacyWorld();
    const r = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    expect(await verifyWithDuties(USERS.admin, r.data.id, { method: "Photo ID seen in person" }, deps(db))).toEqual({ ok: false, status: 403, error: SELF_VERIFY_MESSAGE });
    expect(db.tables.auditEvent.some((e) => e.action === "verify-identity")).toBe(false);
    expect(await verifyWithDuties(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db))).toMatchObject({ ok: true });
    expect(await verifierOf(db as unknown as PrivacyDb, r.data.id)).toBe(USERS.partner.id);
  });

  it(`an "Other" verification needs a note of at least ${OTHER_VERIFY_NOTE_MIN} characters`, async () => {
    expect(verificationNoteProblem("Other (explain in the note)", "trust me")).toBe(OTHER_NOTE_MESSAGE);
    expect(verificationNoteProblem("Other (explain in the note)", "   ")).toBe(OTHER_NOTE_MESSAGE);
    expect(verificationNoteProblem("Other (explain in the note)", "Video call; Aadhaar shown on screen")).toBeNull();
    expect(verificationNoteProblem("Photo ID seen in person", null)).toBeNull();

    const db = privacyWorld();
    const r = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    expect(await verifyWithDuties(USERS.partner, r.data.id, { method: "Other (explain in the note)", note: "trust me" }, deps(db))).toEqual({ ok: false, status: 400, error: OTHER_NOTE_MESSAGE });
  });
});

describe("deciding an erasure", () => {
  it("needs an active partner or admin who did not verify the identity", async () => {
    const db = privacyWorld();
    const pdb = db as unknown as PrivacyDb;
    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));

    await expect(assertErasureDecider(pdb, r.data.id, USERS.partner)).rejects.toMatchObject({ status: 403, message: SELF_ERASURE_MESSAGE });
    await expect(assertErasureDecider(pdb, r.data.id, USERS.manager)).rejects.toMatchObject({ status: 403 });
    await expect(assertErasureDecider(pdb, r.data.id, USERS.inactive)).rejects.toMatchObject({ status: 403 });
    await expect(assertErasureDecider(pdb, r.data.id, USERS.admin)).resolves.toBeUndefined(); // logged it, did not verify it
    await expect(assertErasureDecider(pdb, r.data.id, sessionUser("u-partner2", { level: "PARTNER" }))).resolves.toBeUndefined();
  });
});

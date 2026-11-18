// One request, one person (security audit, critical finding A). Reproduction: two clients share a
// contact phone. Before the fix, a verified request for client A matched both and the access export
// and erasure plan bundled client B's PAN, GSTIN and notes; an erasure that matched nobody completed
// as "0 items anonymised". Now a request that matches several records is parked until a person
// chooses, every data step is scoped to PrivacyRequest.principalRef only, and nothing can complete
// as done when nothing matched.
import { describe, expect, it } from "vitest";
import { buildAccessExport, downloadAccessExport } from "./export";
import { confirmErasure, planErasure, publicPlan } from "./erasure";
import { withdrawConsent } from "./consent";
import { correctForRequest } from "./correction";
import { NOTHING_MATCHED, NOT_RESOLVED, closeRequest, createRequest, getRequest, resolvePrincipal, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import type { CorrectionsDb } from "@/lib/corrections/service";
import { PAN_PROP, T0, USERS, gstinFor, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

const PAN_B = "ABCPS5678K";
const GSTIN_B = gstinFor("29", PAN_B);
const NOTE_B = "Sister's shop: separate books, do not mix";
const SHARED_PHONE = "9876543210"; // also client A's (c-prop) contact phone

function world(): MemoryDb {
  const db = privacyWorld();
  const a = db.tables.client.find((c) => c.id === "c-prop")!;
  db.seed("client", [{ ...a, id: "c-sister", name: "Sunita Stores", folderName: "Sunita Stores", pan: PAN_B, gstin: GSTIN_B, growthNote: NOTE_B, contactName: "Sunita K", contactEmail: "sunita@stores.test", contactPhone: SHARED_PHONE }]);
  return db;
}
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const leaksB = (x: unknown) => {
  const s = JSON.stringify(x);
  return [PAN_B, GSTIN_B, NOTE_B, "sunita@stores.test", "Sunita"].filter((v) => s.includes(v));
};

async function logged(db: MemoryDb, kind: string, identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  await verifyIdentity(USERS.partner, r.data.id, { method: "Call back to the phone number on record" }, deps(db)); // logged by the admin, checked by the partner (duties.ts)
  return r.data;
}
const req = (db: MemoryDb, id: string) => db.tables.privacyRequest.find((r) => r.id === id)!;

describe("a request whose identifiers match several people is parked, never bundled", () => {
  it("is logged with no principal, a plain 'needs manual resolution' label and a note saying what to do", async () => {
    const db = world();
    const r = await logged(db, "access", { phone: SHARED_PHONE });
    expect(r.matches).toBe(2);
    expect(r.notes.at(-1)).toBe(
      "These identifiers match 2 different records, so the request is not linked to anyone yet. Open the request and choose the one it is about before anything is shared, changed or erased.",
    );
    expect(req(db, r.id)).toMatchObject({ principalRef: null, principalLabel: "Needs manual resolution: 2 records match these identifiers" });
  });

  it("export, correction, consent withdrawal, erasure and 'completed' are all refused until one record is chosen; nothing of either client leaks", async () => {
    const db = world();
    const access = await logged(db, "access", { phone: SHARED_PHONE });
    expect(await downloadAccessExport(USERS.admin, access.id, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });
    const ex = await buildAccessExport(pdb(db), access.id, T0);
    expect(ex?.datasets.every((d) => d.records.length === 0)).toBe(true);
    expect(await closeRequest(USERS.admin, access.id, { outcome: "completed", note: "Here is your data, attached." }, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });

    const erasure = await logged(db, "erasure", { phone: SHARED_PHONE });
    const plan = await planErasure(pdb(db), erasure.id, T0);
    expect(plan!.items.filter((i) => i.recordId)).toEqual([]);
    expect(await confirmErasure(USERS.partner, erasure.id, { fingerprint: plan!.fingerprint }, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });

    const consent = await logged(db, "consent-withdrawal", { phone: SHARED_PHONE });
    expect(await withdrawConsent(USERS.admin, consent.id, deps(db))).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });

    const correction = await logged(db, "correction", { phone: SHARED_PHONE });
    const c = await correctForRequest(USERS.admin, correction.id, { entity: "Client", id: "c-sister", field: "city", newValue: "Hubballi", reason: "Client asked us" }, { ...deps(db), corrections: { db: db as unknown as CorrectionsDb } });
    expect(c).toEqual({ ok: false, status: 409, error: NOT_RESOLVED });

    expect(db.tables.client.find((x) => x.id === "c-sister")?.city).not.toBe("Hubballi");
    expect(db.tables.auditEvent.filter((e) => ["anonymise", "restrict-processing", "export", "correct"].includes(String(e.action)))).toEqual([]);
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("once a partner or admin links it to client A, the export and the erasure plan cover client A only — not client B's PAN, GSTIN or notes", async () => {
    const db = world();
    const access = await logged(db, "access", { phone: SHARED_PHONE });
    const d = await getRequest(pdb(db), access.id, T0);
    expect(d?.matches.map((m) => m.ref).sort()).toEqual(["c-prop", "c-sister"]);
    expect(d?.matches.every((m) => !leaksB(m.label).includes(PAN_B))).toBe(true); // candidates are masked
    expect(await resolvePrincipal(USERS.admin, access.id, { ref: "c-prop" }, deps(db))).toMatchObject({ ok: true });
    expect(req(db, access.id)).toMatchObject({ principalRef: "c-prop", principalType: "client-person" });
    const download = await downloadAccessExport(USERS.admin, access.id, deps(db));
    expect(download.ok).toBe(true);
    if (download.ok) {
      expect(leaksB(download.data.data)).toEqual([]);
      expect(JSON.stringify(download.data.data)).toContain(PAN_PROP);
    }

    const erasure = await logged(db, "erasure", { phone: SHARED_PHONE });
    await resolvePrincipal(USERS.partner, erasure.id, { ref: "c-prop" }, deps(db));
    const plan = await planErasure(pdb(db), erasure.id, T0);
    expect(plan!.items.some((i) => i.recordId === "c-prop")).toBe(true);
    expect(plan!.items.some((i) => i.recordId === "c-sister")).toBe(false);
    expect(leaksB(publicPlan(plan!))).toEqual([]);
    const done = await confirmErasure(USERS.admin, erasure.id, { fingerprint: plan!.fingerprint }, deps(db)); // not the verifier
    expect(done.ok).toBe(true);
    const sister = db.tables.client.find((x) => x.id === "c-sister")!;
    expect(sister).toMatchObject({ pan: PAN_B, gstin: GSTIN_B, growthNote: NOTE_B }); // client B untouched
  });

  it("only a record found for the request can be chosen, only once, and only by admins and partners", async () => {
    const db = world();
    const r = await logged(db, "access", { phone: SHARED_PHONE });
    expect(await resolvePrincipal(USERS.staff, r.id, { ref: "c-prop" }, deps(db))).toMatchObject({ ok: false, status: 403 });
    expect(await resolvePrincipal(USERS.admin, r.id, { ref: "c-co" }, deps(db))).toEqual({ ok: false, status: 400, error: "Choose one of the records found for this request." });
    expect((await resolvePrincipal(USERS.admin, r.id, { ref: "c-sister" }, deps(db))).ok).toBe(true);
    expect(await resolvePrincipal(USERS.admin, r.id, { ref: "c-prop" }, deps(db))).toMatchObject({ ok: false, status: 409 });
    const tl = await getRequest(pdb(db), r.id, T0);
    expect(tl?.timeline.at(-1)).toMatchObject({ label: "Linked to one record" });
  });
});

describe("nothing matched: never completed as done", () => {
  it("an erasure that matched nobody is refused (it used to complete as '0 items anonymised'); access can't be 'completed'; refusing with a reason still works", async () => {
    const db = world();
    const erasure = await logged(db, "erasure", { email: "nobody@nowhere.test" });
    const plan = await planErasure(pdb(db), erasure.id, T0);
    expect(await confirmErasure(USERS.partner, erasure.id, { fingerprint: plan!.fingerprint }, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    expect(req(db, erasure.id).status).not.toBe("COMPLETED");

    const access = await logged(db, "access", { email: "nobody@nowhere.test" });
    expect(await downloadAccessExport(USERS.admin, access.id, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    expect(await closeRequest(USERS.admin, access.id, { outcome: "completed", note: "We hold no data about you." }, deps(db))).toEqual({ ok: false, status: 409, error: NOTHING_MATCHED });
    expect((await closeRequest(USERS.admin, access.id, { outcome: "rejected", note: "We could not find any record of you; please send another identifier." }, deps(db))).ok).toBe(true);
  });

  it("a grievance (no personal data step) still closes as completed without a match", async () => {
    const db = world();
    const r = await createRequest(USERS.admin, { kind: "grievance", identifiers: { email: "nobody@nowhere.test" } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    expect((await closeRequest(USERS.admin, r.data.id, { outcome: "completed", note: "We have fixed the reminder emails." }, deps(db))).ok).toBe(true);
  });
});

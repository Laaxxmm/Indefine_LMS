// Re-audit NEW-8 (LOW): certificates and engagement letters were found by Client.name equality, so a
// certificate issued for a NON-client with the same name ("Sri Sai Traders", a different proprietor)
// travelled in client A's access export and was anonymised by A's erasure. Ported from the re-audit
// PoC privacy-resolution.test.ts ("name join"). Now they are joined by CertificateIssue.clientId /
// EngagementLetter.clientId; a name-only match is a manual check for a partner, never exported or erased.
import { describe, expect, it } from "vitest";
import { buildAccessExport } from "./export";
import { confirmErasure, planErasure } from "./erasure";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import { clientLinkFor } from "./client-link";
import { T0, USERS, world } from "./__tests__/fixtures";
import type { MemoryDb } from "./__tests__/memory-db";

const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });
const PAN_A = "AAAPA1111A";
const PAN_B = "BBBPB2222B";

function seed(db: MemoryDb) {
  const base = { entityType: "PROPRIETORSHIP", cin: null, industry: null, referralSource: null, turnover: 1, turnoverBand: "UNDER_40L", growthGoal: "MAINTAIN", onboardedOn: T0, primaryHandlerId: USERS.staff.id, active: true, graphFolderId: null, folderStatus: "PENDING", createdById: USERS.partner.id, gstin: null };
  db.seed("client", [{ ...base, id: "c-a", name: "Sri Sai Traders", folderName: "Sri Sai Traders", pan: PAN_A, city: "Hubli", contactName: "Arun A", contactPhone: "9111100001", contactEmail: "arun@a.test", growthNote: "A note" }]);
  const cert = { formatId: "i", formatTitle: "Net worth", templateVersion: "1", templateHash: "h", clientName: "Sri Sai Traders", acknowledged: false, createdById: USERS.partner.id, createdAt: new Date("2016-05-01T00:00:00.000Z") };
  db.seed("certificateIssue", [
    { ...cert, id: "cert-b", clientId: null, payload: { pan: PAN_B, netWorth: 9_000_000, owner: "Bhavna B" } }, // a non-client with the same name
    { ...cert, id: "cert-a", clientId: "c-a", payload: { pan: PAN_A, netWorth: 1_000_000 } }, // issued from A's record
  ]);
  db.seed("engagementLetter", [{ id: "el-b", clientName: "Sri Sai Traders", clientId: null, data: { pan: PAN_B, contact: "Bhavna B", fee: 50000 }, sentTo: "bhavna@b.test", createdById: USERS.partner.id, createdAt: new Date("2016-05-01T00:00:00.000Z") }]);
}

describe("NEW-8: certificates and letters joined by client id", () => {
  it("PoC: A's access export holds A's linked certificate, not B's same-name certificate or letter; the name-only records are a manual check", async () => {
    const db = world();
    seed(db);
    const r = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: PAN_A } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
    const x = (await buildAccessExport(db as unknown as PrivacyDb, r.data.id, T0, "k"))!;
    const text = JSON.stringify(x.datasets);
    expect(text).toContain(PAN_A);
    expect(text).not.toContain(PAN_B);
    expect(text).not.toContain("Bhavna");
    expect(x.datasets.find((d) => d.key === "certificates")?.records.map((c) => c.id)).toEqual(["cert-a"]);
    expect(x.manualChecks).toEqual([expect.stringMatching(/^1 certificate and 1 engagement letter carry this client's name but are not linked/)]);
  });

  it("PoC: A's erasure anonymises A's linked certificate and never touches B's; the plan lists a manual check", async () => {
    const db = world();
    seed(db);
    db.tables.client.find((c) => c.id === "c-a")!.active = false; // A left long ago: no duty in force
    const r = await createRequest(USERS.admin, { kind: "erasure", identifiers: { pan: PAN_A } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
    const plan = (await planErasure(db as unknown as PrivacyDb, r.data.id, T0, { hashKey: "k" } as never))!;
    expect(plan.items.find((i) => i.dataset === "name-only-records")).toMatchObject({ action: "manual", model: null, recordId: null });
    expect(plan.items.some((i) => i.recordId === "cert-b" || i.recordId === "el-b")).toBe(false);
    const c = await confirmErasure(USERS.admin, r.data.id, { fingerprint: plan.fingerprint }, deps(db));
    expect(c.ok).toBe(true);
    const b = db.tables.certificateIssue.find((x) => x.id === "cert-b")!;
    expect(b).toMatchObject({ clientName: "Sri Sai Traders", payload: { pan: PAN_B, owner: "Bhavna B" } });
    expect(db.tables.engagementLetter.find((x) => x.id === "el-b")).toMatchObject({ clientName: "Sri Sai Traders", sentTo: "bhavna@b.test" });
    expect(String(db.tables.certificateIssue.find((x) => x.id === "cert-a")!.clientName)).toBe("[erased]");
  });

  it("a certificate / letter is linked only when issued from the client record with its own name", async () => {
    const db = { client: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "c-a" ? { id: "c-a", name: "Sri Sai Traders" } : null) } };
    expect(await clientLinkFor(db, undefined, "Sri Sai Traders")).toEqual({ ok: true, clientId: null });
    expect(await clientLinkFor(db, "c-a", " sri  sai traders ")).toEqual({ ok: true, clientId: "c-a" });
    expect(await clientLinkFor(db, "c-a", "Sri Sai Traders (Belagavi)")).toEqual({ ok: true, clientId: null }); // an edited name is another entity
    expect(await clientLinkFor(db, "c-x", "Sri Sai Traders")).toMatchObject({ ok: false, status: 400 });
    expect(await clientLinkFor(db, "../x", "Sri Sai Traders")).toMatchObject({ ok: false, status: 400 });
  });
});

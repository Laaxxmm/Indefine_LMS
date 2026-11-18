// Re-audit NEW-9 (LOW): an access request for a PAN known only from a failed onboarding resolved to
// that run, and the export carried the whole prompt — the other people named in it (a partner, an
// accountant, their phones and e-mail) went out with it. Ported from the re-audit PoC
// privacy-resolution.test.ts ("identifier-only"). Now only the person's own identifiers and the names
// the run recorded for the client itself are kept; everything else is withheld.
import { describe, expect, it } from "vitest";
import { WITHHELD_THIRD_PARTY, buildAccessExport, scrubThirdParties } from "./export";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import type { PrivacyDb } from "./inventory";
import { T0, USERS, privacyWorld } from "./__tests__/fixtures";
import type { MemoryDb } from "./__tests__/memory-db";

const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });
const GHOST = "GHOPG9999G";

describe("NEW-9: identifier-only exports withhold third parties", () => {
  it("PoC: the export keeps the person's PAN and the run's own contact name, not the partner's or accountant's details", async () => {
    const db = privacyWorld();
    db.seed("onboardingRun", [
      {
        id: "ob-ghost",
        createdById: USERS.partner.id,
        prompt: `Onboard Ghost Traders PAN ${GHOST}; partner Hema Rao 9333300003 hema@x.test; accountant Vijay Nair 9444400004`,
        spec: { pan: GHOST, contactName: "Ghost Owner", directors: [{ name: "Hema Rao", phone: "9333300003" }] },
        plan: null,
        status: "FAILED",
        steps: null,
        error: "x",
        firmClientId: null,
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    const r = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: GHOST } }, deps(db));
    if (!r.ok) throw new Error(r.error);
    await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
    const x = await buildAccessExport(db as unknown as PrivacyDb, r.data.id, T0, "k");
    const text = JSON.stringify(x);
    expect(text).toContain(GHOST);
    expect(text).toContain("Ghost Owner");
    for (const s of ["9333300003", "9444400004", "hema@x.test", "Hema Rao", "Vijay Nair"]) expect(text, s).not.toContain(s);
    expect(text).toContain(WITHHELD_THIRD_PARTY);
  });

  it("the person's own phone and e-mail are kept when they are what the request matched", () => {
    const row = { id: "r", prompt: "Contact 9876501234, own@x.test; CA's office 9123456780", spec: { contactPhone: "9876501234", contactEmail: "own@x.test" } };
    const out = scrubThirdParties(row, [{ kind: "phone", value: "9876501234" }, { kind: "email", value: "own@x.test" }]);
    expect(out.prompt).toBe(`Contact 9876501234, own@x.test; CA's office ${WITHHELD_THIRD_PARTY}`);
    expect(out.spec).toEqual({ contactPhone: "9876501234", contactEmail: "own@x.test" });
  });
});

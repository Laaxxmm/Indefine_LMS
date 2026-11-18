// SOP review H1: SOP screenshots and SOP free text are in the DPDP inventory. The access export
// lists the screenshots under steps that name the person (by link, never the bytes) and tells a
// partner that pictures cannot be searched; the erasure plan blanks those screenshots in place
// (UPDATE, never a delete), cleans the person out of the SOP text, keeps every other screenshot,
// and names the manual OneDrive step. In-memory database (src/lib/privacy/__tests__/memory-db.ts).
import { describe, expect, it } from "vitest";
import { buildAccessExport } from "@/lib/privacy/export";
import { confirmErasure, planErasure } from "@/lib/privacy/erasure";
import { createRequest, verifyIdentity, type PrivacyDeps } from "@/lib/privacy/register";
import type { PrivacyDb } from "@/lib/privacy/inventory";
import { PAN_PROP, T0, USERS, privacyWorld } from "@/lib/privacy/__tests__/fixtures";
import { removalCalls, type MemoryDb } from "@/lib/privacy/__tests__/memory-db";

type Row = Record<string, unknown>;
const KEY = "k";
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: KEY });
const pdb = (db: MemoryDb) => db as unknown as PrivacyDb;
const find = (db: MemoryDb, model: string, id: string) => db.tables[model].find((r) => r.id === id) as Row;

const step = (no: string, action: string, screens: { imageId: string; caption: string }[] = []) => ({ no, role: "Assistant", action, system: "Tally Prime", input: "", output: "", ifThen: [], control: "", ...(screens.length ? { screens } : {}) });
/** One SOP whose gap answer and one step name `client`; another step shows the demo company. */
function seedSop(db: MemoryDb, client: string) {
  db.seed("sop", [{ id: "sop-1", title: "Bank reconciliation", department: "ACCOUNTS", workCategory: "Books", createdById: USERS.staff.id, createdByName: "Asha Rao" }]);
  db.seed("sopVersion", [
    {
      id: "sv-1",
      sopId: "sop-1",
      versionNumber: 1,
      versionString: "v1",
      purpose: "Reconcile the bank every month.",
      rawProcedure: `Match the bank statement. Q: Which client is the example? A: ${client}, whose bank is HDFC.`,
      brief: { title: "Bank reconciliation" },
      content: {
        schemaVersion: 2,
        preparedBy: "Asha Rao, Senior Accountant",
        subProcesses: [{ code: "P01", name: "Match", steps: [step("P01.1", `Open the bank ledger of ${client}`, [{ imageId: "img-client", caption: "Ledger" }]), step("P01.2", "Tick the matched entries", [{ imageId: "img-demo", caption: "Demo company" }])] }],
      },
      createdById: USERS.staff.id,
      creatorName: "Asha Rao",
      creatorDesignation: "Senior Accountant",
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
    },
  ]);
  db.seed("sopImage", [
    { id: "img-client", sopId: "sop-1", mime: "image/png", bytes: Uint8Array.from([1, 2, 3]), width: 1, height: 1, createdById: USERS.staff.id, createdAt: new Date("2026-11-01T00:00:00.000Z"), removedAt: null },
    { id: "img-demo", sopId: "sop-1", mime: "image/png", bytes: Uint8Array.from([4, 5, 6]), width: 1, height: 1, createdById: USERS.staff.id, createdAt: new Date("2026-11-01T00:00:00.000Z"), removedAt: null },
  ]);
}

async function verified(db: MemoryDb, kind: "access" | "erasure", identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  const v = await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db));
  if (!v.ok) throw new Error(v.error);
  return r.data.id;
}

describe("H1: SOP screenshots and text in the access export", () => {
  it("lists the screenshot under the step that names the client (by link), not the demo one, and asks a partner to check the rest", async () => {
    const db = privacyWorld();
    seedSop(db, "Kumar Traders");
    const id = await verified(db, "access", { pan: PAN_PROP });
    const x = (await buildAccessExport(pdb(db), id, T0))!;
    const shots = x.datasets.find((d) => d.key === "sop-screenshots")!;
    expect(shots.records).toEqual([{ id: "img-client", values: { stepNo: "P01.1", caption: "Ledger", bytes: "/api/tools/sop-builder/sops/sop-1/images/img-client", createdAt: expect.any(Date), removedAt: null } }]);
    expect(x.manualChecks).toContainEqual(expect.stringMatching(/^The SOP Builder holds 2 screenshots of the firm's software\. A picture cannot be searched for a person's details/));
    expect(x.notIncluded).toContainEqual(expect.stringMatching(/^SOP screenshots themselves/));
  });
});

describe("H1: SOP screenshots and text in the erasure plan", () => {
  it("blanks the screenshot that names the client, cleans the SOP text, keeps the rest, and names the OneDrive step", async () => {
    const db = privacyWorld();
    seedSop(db, "Old Ledger Accounts"); // c-old: every retention duty has run out at T0
    const id = await verified(db, "erasure", { pan: "DEFPO1111A" });
    const plan = (await planErasure(pdb(db), id, T0, { hashKey: KEY }))!;
    const by = (ds: string) => plan.items.filter((i) => i.dataset === ds);
    expect(by("sop-screenshots")).toEqual([expect.objectContaining({ action: "anonymise", recordId: "img-client", fields: ["bytes", "removedAt"] })]);
    expect(by("sop-text")).toEqual([expect.objectContaining({ action: "anonymise", records: [expect.objectContaining({ id: "sv-1" })] })]);
    expect(by("sop-text")[0].fields).toEqual(["rawProcedure", "content"]);
    expect(by("sop-screenshots-manual")).toEqual([expect.objectContaining({ action: "manual" })]);
    expect(by("sop-onedrive")).toEqual([expect.objectContaining({ action: "manual", consequence: expect.stringMatching(/Word files in OneDrive keep them until they are saved again/) })]);

    const sizes = { sopImage: db.tables.sopImage.length, sopVersion: db.tables.sopVersion.length };
    const c = await confirmErasure(USERS.admin, id, { fingerprint: plan.fingerprint }, deps(db));
    expect(c.ok).toBe(true);

    const shot = find(db, "sopImage", "img-client");
    expect(shot.bytes).toEqual(new Uint8Array(0));
    expect(shot.removedAt).toBeInstanceOf(Date);
    expect(find(db, "sopImage", "img-demo")).toMatchObject({ bytes: Uint8Array.from([4, 5, 6]), removedAt: null });
    const v = find(db, "sopVersion", "sv-1");
    expect(JSON.stringify([v.rawProcedure, v.content])).not.toContain("Old Ledger Accounts");
    expect(v.rawProcedure).toBe("Match the bank statement. Q: Which client is the example? A: [erased], whose bank is HDFC.");
    expect((v.content as { preparedBy: string }).preparedBy).toBe("Asha Rao, Senior Accountant"); // staff author kept: not this person's data
    expect({ sopImage: db.tables.sopImage.length, sopVersion: db.tables.sopVersion.length }).toEqual(sizes);
    expect(removalCalls(db.calls)).toEqual([]);
    const audited = new Set(db.tables.auditEvent.filter((e) => e.action === "anonymise").map((e) => `${String(e.entity)}:${String(e.entityId)}`));
    expect([...audited]).toEqual(expect.arrayContaining(["SopImage:img-client", "SopVersion:sv-1"]));
    expect(db.tables.auditEvent.filter((e) => e.action === "erasure-manual-step").map((e) => (e.meta as Row).system)).toEqual(expect.arrayContaining(["sop-screenshots-manual", "sop-onedrive"]));
  });
});

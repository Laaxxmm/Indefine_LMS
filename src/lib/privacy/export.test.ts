import { describe, expect, it } from "vitest";
import { buildAccessExport, downloadAccessExport } from "./export";
import { createRequest, verifyIdentity, type PrivacyDeps } from "./register";
import { DATASETS, datasetsFor, type PrivacyDb } from "./inventory";
import { PAN_CO, PAN_PROP, SUPPLIER_PAN, T0, USERS, ZENITH_SIGNATORY, privacyWorld } from "./__tests__/fixtures";
import type { MemoryDb } from "./__tests__/memory-db";

const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => T0, hashKey: "k" });

async function verifiedRequest(db: MemoryDb, kind: string, identifiers: Record<string, string>) {
  const r = await createRequest(USERS.admin, { kind, identifiers }, deps(db));
  if (!r.ok) throw new Error(r.error);
  await verifyIdentity(USERS.partner, r.data.id, { method: "Photo ID seen in person" }, deps(db)); // logged by the admin, checked by the partner (duties.ts)
  return r.data.id;
}

describe("access export", () => {
  it("contains every inventoried field for a client principal, with that client's values", async () => {
    const db = privacyWorld();
    const id = await verifiedRequest(db, "access", { pan: PAN_PROP });
    const x = await buildAccessExport(db as unknown as PrivacyDb, id, T0);
    expect(x).not.toBeNull();
    if (!x) return;
    const expected = datasetsFor("client-person");
    expect(x.datasets.map((d) => d.key)).toEqual(expected.map((d) => d.key));
    for (const ds of expected) {
      const got = x.datasets.find((d) => d.key === ds.key)!;
      expect(got.fields.map((f) => f.name)).toEqual(ds.fields.map((f) => f.name));
      for (const rec of got.records) expect(Object.keys(rec.values)).toEqual(ds.fields.map((f) => f.name));
    }
    const identity = x.datasets.find((d) => d.key === "client-identity")!;
    expect(identity.records[0].values).toMatchObject({ name: "Kumar Traders", pan: PAN_PROP, city: "Bengaluru" });
    expect(x.datasets.find((d) => d.key === "client-contact")!.records[0].values).toEqual({ contactName: "Kiran Kumar", contactPhone: "9876543210", contactEmail: "kiran@kumartraders.test" });
    expect(x.datasets.find((d) => d.key === "job-tasks")!.records).toHaveLength(2);
    expect(x.datasets.find((d) => d.key === "certificates")!.records.map((r) => r.id)).toEqual(["cert-prop"]);
    expect(x.datasets.find((d) => d.key === "agent-runs")!.records[0].values).toMatchObject({ agent: "gst", inputsCached: true });
    expect(x.summary[0]).toMatch(/^Firm OS and the LMS client master hold \d+ records about this person, in \d+ categories\.$/);
    expect(x.summary.at(-1)).toMatch(/^Shared with: Microsoft 365/);
    expect(x.principal).toMatchObject({ type: "client-person", label: "K. T. · KUMAR1 · PAN ****234F" });
  });

  it("contains nothing of other people: other clients, suppliers in cached inputs, staff", async () => {
    const db = privacyWorld();
    const id = await verifiedRequest(db, "access", { pan: PAN_PROP });
    const text = JSON.stringify(await buildAccessExport(db as unknown as PrivacyDb, id, T0));
    for (const other of [PAN_CO, "Zenith", "zara@zenith.test", ZENITH_SIGNATORY, "Lalitha", "c-prospect", "Old Ledger", SUPPLIER_PAN, "priya@indefine.test", "Priya Staff", "u-staff"]) {
      expect(text).not.toContain(other);
    }
  });

  it("gives a company contact only their contact details and message drafts", async () => {
    const db = privacyWorld();
    const id = await verifiedRequest(db, "access", { email: "zara@zenith.test" });
    const x = await buildAccessExport(db as unknown as PrivacyDb, id, T0);
    expect(x?.datasets.map((d) => d.key)).toEqual(datasetsFor("client-contact").map((d) => d.key));
    const text = JSON.stringify(x);
    expect(text).toContain("Zara Iyer");
    expect(text).not.toContain(PAN_CO);
    expect(text).not.toContain("Turnover certificate");
  });

  it("gives a staff member their own staff data only", async () => {
    const db = privacyWorld();
    const id = await verifiedRequest(db, "access", { email: "priya@indefine.test" });
    const x = await buildAccessExport(db as unknown as PrivacyDb, id, T0);
    expect(x?.datasets.map((d) => d.key)).toEqual(DATASETS.filter((d) => d.principals.includes("staff")).map((d) => d.key));
    const attendance = x?.datasets.find((d) => d.key === "staff-attendance");
    expect(attendance?.records.map((r) => r.id)).toEqual(["att-1"]);
    expect(JSON.stringify(x)).not.toContain(PAN_PROP);
  });

  it("downloads only for a verified access request, and audits the download without personal data", async () => {
    const db = privacyWorld();
    const unverified = await createRequest(USERS.admin, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db));
    if (!unverified.ok) throw new Error("setup");
    expect(await downloadAccessExport(USERS.admin, unverified.data.id, deps(db))).toMatchObject({ ok: false, status: 409 });
    const erasure = await verifiedRequest(db, "erasure", { pan: PAN_PROP });
    expect(await downloadAccessExport(USERS.admin, erasure, deps(db))).toMatchObject({ ok: false, status: 409 });
    expect(await downloadAccessExport(USERS.admin, "missing", deps(db))).toMatchObject({ ok: false, status: 404 });
    expect(await downloadAccessExport(USERS.staff, unverified.data.id, deps(db))).toMatchObject({ ok: false, status: 403 });

    const id = await verifiedRequest(db, "access", { pan: PAN_PROP });
    const r = await downloadAccessExport(USERS.partner, id, deps(db));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.filename).toBe(`privacy-export-${id}.json`);
    const audit = db.tables.auditEvent.filter((e) => e.action === "export");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(PAN_PROP);
  });
});

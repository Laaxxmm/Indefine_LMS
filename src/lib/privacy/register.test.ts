import { describe, expect, it } from "vitest";
import { closeRequest, createRequest, getRequest, listRequests, recordNomination, verifyIdentity, type PrivacyDeps } from "./register";
import { dueDateFor, outerLimitFor, RESPONSE_TIMELINES } from "./policy";
import { identifierHash, normaliseIdentifier, prismaPrincipalLocator } from "./locator";
import type { PrivacyDb } from "./inventory";
import { PAN_CO, PAN_PROP, T0, USERS, privacyWorld } from "./__tests__/fixtures";
import { removalCalls, type MemoryDb } from "./__tests__/memory-db";

type Row = Record<string, unknown>;
const deps = (db: MemoryDb, now = () => T0): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now, hashKey: "test-key" });
const req = (db: MemoryDb, id: string) => db.tables.privacyRequest.find((r) => r.id === id) as Row;
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().replace("Z", "+05:30");

async function logged(db: MemoryDb, kind: string, identifiers: Record<string, string>, extra: Record<string, unknown> = {}) {
  const r = await createRequest(USERS.admin, { kind, identifiers, ...extra }, deps(db));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe("request register", () => {
  it("logs a request, finds the person by PAN and keeps only a hash and a masked label", async () => {
    const db = privacyWorld();
    const r = await logged(db, "access", { pan: "abcpk1234f" }, { notes: "Kiran phoned from 9876543210 asking for his data" });
    expect(r.matches).toBe(1);
    const row = req(db, r.id);
    expect(row).toMatchObject({ kind: "access", principalType: "client-person", principalRef: "c-prop", status: "RECEIVED", createdById: USERS.admin.id });
    expect(row.principalLabel).toBe("K. T. · KUMAR1 · PAN ****234F");
    expect(row.identifierHash).toBe(identifierHash([{ kind: "pan", value: PAN_PROP }], "test-key"));
    const stored = JSON.stringify([db.tables.privacyRequest, db.tables.auditEvent]);
    expect(stored).not.toContain(PAN_PROP);
    expect(stored).not.toContain("9876543210");
    expect(db.tables.auditEvent.map((e) => e.action)).toEqual(["create", "locate"]);
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("matches contacts of companies as client contacts and staff by their LMS email", async () => {
    const db = privacyWorld();
    const contact = await logged(db, "erasure", { email: "ZARA@zenith.test" });
    expect(req(db, contact.id)).toMatchObject({ principalType: "client-contact", principalRef: "c-co" });
    const staff = await logged(db, "access", { email: "priya@indefine.test" });
    expect(req(db, staff.id)).toMatchObject({ principalType: "staff", principalRef: USERS.staff.id });
    expect(String(req(db, staff.id).principalLabel)).toMatch(/^Staff P\. S\. · email \*\*\*\*test$/);
    const phone = await logged(db, "correction", { phone: "+91 98765 43210" });
    expect(req(db, phone.id)).toMatchObject({ principalType: "client-person", principalRef: "c-prop" });
  });

  it("explains that a company PAN is not a person, and still logs the request", async () => {
    const db = privacyWorld();
    const r = await logged(db, "access", { pan: PAN_CO });
    expect(r.matches).toBe(0);
    expect(r.notes[0]).toMatch(/belongs to a company or firm .* Search by the person's own email or phone instead\./);
    expect(req(db, r.id)).toMatchObject({ principalRef: null, principalLabel: "No matching records in Firm OS" });
  });

  it("refuses bad input with sentences that say what to do", async () => {
    const db = privacyWorld();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ kind: "complaint", identifiers: { pan: PAN_PROP } }, /Pick the kind of request/],
      [{ kind: "access", identifiers: {} }, /Enter at least one identifier/],
      [{ kind: "access", identifiers: { pan: "ABC" } }, /Enter the PAN as 10 characters/],
      [{ kind: "access", identifiers: { email: "kiran" } }, /Enter a full email address/],
      [{ kind: "access", identifiers: { pan: PAN_PROP }, receivedOn: "2026-11-06" }, /can't be in the future/],
    ];
    for (const [input, msg] of cases) {
      const r = await createRequest(USERS.admin, input as never, deps(db));
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(await createRequest(USERS.manager, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db))).toMatchObject({ ok: false, status: 403 });
    expect(await createRequest(USERS.inactive, { kind: "access", identifiers: { pan: PAN_PROP } }, deps(db))).toMatchObject({ ok: false, status: 401 });
    expect(await createRequest(USERS.partner, { kind: "grievance", identifiers: {} }, deps(db))).toMatchObject({ ok: true });
  });
});

describe("due dates (policy data, partner/legal to verify)", () => {
  it("grievances are due 30 days after receipt at the end of the IST day, with the 90-day outer limit shown", async () => {
    const db = privacyWorld();
    const r = await logged(db, "grievance", { email: "kiran@kumartraders.test" }, { receivedOn: "2026-11-01" });
    const row = req(db, r.id);
    expect(ist(row.receivedAt as Date)).toBe("2026-11-01T00:00:00.000+05:30");
    expect(ist(row.dueAt as Date)).toBe("2026-12-01T23:59:59.999+05:30");
    expect(ist(outerLimitFor(row.receivedAt as Date))).toBe("2027-01-30T23:59:59.999+05:30");
    expect(RESPONSE_TIMELINES.grievance.verify).toMatch(/Partner\/legal to verify/);
  });

  it("consent withdrawal is due in 7 days; today's requests keep the time they were logged", () => {
    expect(ist(dueDateFor("consent-withdrawal", T0))).toBe("2026-11-12T23:59:59.999+05:30");
    expect(ist(dueDateFor("access", new Date("2026-11-05T18:29:00.000Z")))).toBe("2026-12-05T23:59:59.999+05:30");
    expect(ist(dueDateFor("access", new Date("2026-11-05T18:31:00.000Z")))).toBe("2026-12-06T23:59:59.999+05:30");
  });

  it("lists requests by due date, flags overdue ones and counts them for the tiles", async () => {
    const db = privacyWorld();
    await logged(db, "access", { pan: PAN_PROP }, { receivedOn: "2026-09-01" });
    await logged(db, "grievance", { email: "kiran@kumartraders.test" }, { receivedOn: "2026-10-31" });
    await logged(db, "consent-withdrawal", { email: "kiran@kumartraders.test" });
    const { rows, counts } = await listRequests(db as unknown as PrivacyDb, {}, T0);
    expect(rows.map((r) => [r.kind, r.overdue])).toEqual([
      ["access", true],
      ["consent-withdrawal", false],
      ["grievance", false],
    ]);
    expect(rows[0].dueLabel).toBe("01 Oct 2026");
    expect(counts).toEqual({ open: 3, overdue: 1, dueSoon: 1, onHold: 0 });
    expect((await listRequests(db as unknown as PrivacyDb, { overdue: true }, T0)).rows).toHaveLength(1);
    expect((await listRequests(db as unknown as PrivacyDb, { kind: "grievance" }, T0)).rows).toHaveLength(1);
  });
});

describe("workflow steps", () => {
  it("verifies identity once, with a known method, and moves the request in progress", async () => {
    const db = privacyWorld();
    const { id } = await logged(db, "access", { pan: PAN_PROP });
    expect(await verifyIdentity(USERS.admin, id, { method: "Telepathy" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await verifyIdentity(USERS.admin, id, { method: "Other (explain in the note)" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await verifyIdentity(USERS.admin, id, { method: "Call back to the phone number on record", note: "Called 9876543210" }, deps(db))).toMatchObject({ ok: true });
    expect(req(db, id)).toMatchObject({ status: "IN_PROGRESS", handledById: USERS.admin.id });
    expect(JSON.stringify(db.tables.auditEvent)).not.toContain("9876543210");
    expect(await verifyIdentity(USERS.admin, id, { method: "Photo ID seen in person" }, deps(db))).toMatchObject({ ok: false, status: 409 });
  });

  it("closes an access request only after identity is verified; grievances can be answered straight away", async () => {
    const db = privacyWorld();
    const access = await logged(db, "access", { pan: PAN_PROP });
    const early = await closeRequest(USERS.admin, access.id, { outcome: "completed", note: "Export sent by email on 06 Nov." }, deps(db));
    expect(early).toMatchObject({ ok: false, status: 409, error: "Verify the person's identity first, so their data goes only to them." });
    const grievance = await logged(db, "grievance", { email: "kiran@kumartraders.test" });
    expect(await closeRequest(USERS.partner, grievance.id, { outcome: "completed", note: "Short" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await closeRequest(USERS.partner, grievance.id, { outcome: "completed", note: "Apologised for the delay; the reminder schedule is fixed." }, deps(db))).toMatchObject({ ok: true });
    expect(req(db, grievance.id)).toMatchObject({ status: "COMPLETED", outcome: "Apologised for the delay; the reminder schedule is fixed." });
    expect(await closeRequest(USERS.partner, grievance.id, { outcome: "rejected", note: "Changed my mind entirely." }, deps(db))).toMatchObject({ ok: false, status: 409 });
  });

  it("an erasure request is completed from its plan, but can be refused here with a reason", async () => {
    const db = privacyWorld();
    const { id } = await logged(db, "erasure", { pan: PAN_PROP });
    await verifyIdentity(USERS.admin, id, { method: "Photo ID seen in person" }, deps(db));
    const r = await closeRequest(USERS.admin, id, { outcome: "completed", note: "All erased as asked by the client." }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/from its erasure plan/);
    expect(await closeRequest(USERS.admin, id, { outcome: "rejected", note: "The requester could not prove who they are." }, deps(db))).toMatchObject({ ok: true });
    expect(req(db, id).status).toBe("REJECTED");
  });

  it("records a nominee in the register, with initials only in the audit", async () => {
    const db = privacyWorld();
    const { id } = await logged(db, "nomination", { pan: PAN_PROP });
    expect(await recordNomination(USERS.admin, id, { nomineeName: "Meena Kumar", relationship: "spouse", nomineeContact: "9000011111" }, deps(db))).toMatchObject({ ok: false, status: 409 });
    await verifyIdentity(USERS.admin, id, { method: "Signed letter matching the records" }, deps(db));
    expect(await recordNomination(USERS.admin, id, { nomineeName: "M", relationship: "spouse", nomineeContact: "9000011111" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await recordNomination(USERS.admin, id, { nomineeName: "Meena Kumar", relationship: "spouse", nomineeContact: "9000011111" }, deps(db))).toMatchObject({ ok: true });
    expect(req(db, id)).toMatchObject({ status: "COMPLETED", outcome: "Nominee recorded: M. K. (spouse)." });
    expect(String(req(db, id).notes)).toContain("Nominee: Meena Kumar (spouse), contact 9000011111.");
    expect(JSON.stringify(db.tables.auditEvent)).not.toContain("Meena");
  });

  it("shows the request with its matches and a readable timeline", async () => {
    const db = privacyWorld();
    const { id } = await logged(db, "access", { pan: PAN_PROP });
    await verifyIdentity(USERS.admin, id, { method: "Photo ID seen in person" }, deps(db));
    const d = await getRequest(db as unknown as PrivacyDb, id, T0);
    expect(d).toMatchObject({ verified: true, matches: [{ principalType: "client-person", ref: "c-prop" }], outerLimitLabel: "03 Feb 2027", dueLabel: "05 Dec 2026" });
    expect(d?.timeline.map((e) => e.label)).toEqual(["Request logged", "Records searched", "Identity verified"]);
    expect(d?.timeline[1].detail).toBe("1 matching record found.");
    expect(d?.timeline[2]).toMatchObject({ actorName: "Asha Admin", detail: "Photo ID seen in person", atLabel: "05 Nov 2026 11:00" });
    expect(await getRequest(db as unknown as PrivacyDb, "nope", T0)).toBeNull();
  });
});

describe("locator", () => {
  it("normalises identifiers before matching and rejects unusable ones", () => {
    expect(normaliseIdentifier("pan", " abcpk1234f ")).toBe("ABCPK1234F");
    expect(normaliseIdentifier("phone", "+91-98765-43210")).toBe("9876543210");
    expect(normaliseIdentifier("phone", "12345")).toBeNull();
    expect(normaliseIdentifier("email", "A@B.IN")).toBe("a@b.in");
    expect(normaliseIdentifier("gstin", "29abcpk1234f1z5")).toBe("29ABCPK1234F1Z5");
    expect(identifierHash([])).toBeNull();
  });

  it("finds nothing of other people for a principal's identifiers", async () => {
    const db = privacyWorld();
    const r = await prismaPrincipalLocator(db as unknown as PrivacyDb).locate([{ kind: "email", value: "lalitha@consult.test" }]);
    expect(r.matches.map((m) => m.ref)).toEqual(["c-prospect"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { correctField, REASON_MESSAGE, SAME_VALUE_MESSAGE, type CorrectionDeps, type CorrectionsDb } from "./service";
import { ALLOW_LIST, SITE_EXISTS_MESSAGE } from "./allowlist";
import { removalCalls, type MemoryDb } from "@/lib/privacy/__tests__/memory-db";
import { PAN_CO, USERS, gstinFor, world } from "@/lib/privacy/__tests__/fixtures";

type Row = Record<string, unknown>;
const deps = (db: MemoryDb, extra: Partial<CorrectionDeps> = {}): CorrectionDeps => ({ db: db as unknown as CorrectionsDb, ...extra });
const row = (db: MemoryDb, model: string, id: string) => db.tables[model].find((r) => r.id === id) as Row;
const audits = (db: MemoryDb) => (db.tables.auditEvent ?? []) as Row[];
const REASON = "Typed from the wrong KYC sheet";

describe("allow-list", () => {
  it("refuses fields that are not on the allow-list, with a sentence saying what to do, and writes nothing", async () => {
    const db = world();
    const cases: [string, string, RegExp][] = [
      ["Client", "name", /client page/],
      ["Client", "folderStatus", /On a client you can correct: entity type, PAN, GSTIN/],
      ["JobTask", "ackRef", /retracting the filing confirmation/],
      ["JobTask", "state", /buttons on the job page/],
      ["JobTask", "statutoryDueOn", /SOP pack calendar/],
      ["FirmClient", "clSiteUrl", /Ask IT/],
      ["CommsDraft", "outlookDraftId", /you can correct: subject, message/],
    ];
    for (const [entity, field, msg] of cases) {
      const r = await correctField(USERS.admin, { entity, id: "c-prop", field, newValue: "x", reason: REASON }, deps(db));
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (!r.ok) {
        expect(r.error).toMatch(msg);
        expect(r.error).toMatch(/[.]$/);
        expect(r.error).not.toMatch(/P2002|E\d{3}|undefined/);
      }
    }
    const unknown = await correctField(USERS.admin, { entity: "User", id: "u-staff", field: "email", newValue: "x", reason: REASON }, deps(db));
    expect(unknown).toMatchObject({ ok: false, status: 400 });
    expect(db.calls.filter((c) => /\.(update|create)$/.test(c))).toEqual([]);
  });

  it("every allow-listed field has a label, an owner and a parser", () => {
    for (const fields of Object.values(ALLOW_LIST)) {
      for (const spec of Object.values(fields)) {
        expect(spec.label.length).toBeGreaterThan(1);
        expect(["management", "job-manager", "creator"]).toContain(spec.who);
        expect(typeof spec.parse).toBe("function");
      }
    }
  });

  it("needs a reason of at least five characters", async () => {
    const db = world();
    const r = await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "city", newValue: "Mysuru", reason: "oops" }, deps(db));
    expect(r).toEqual({ ok: false, status: 400, error: REASON_MESSAGE });
  });
});

describe("validation reuses the /clients schema and the onboarding validators", () => {
  const goodGstin = gstinFor("29", "ABCPK1234F");
  const badChecksum = goodGstin.slice(0, 14) + (goodGstin[14] === "0" ? "1" : "0");
  const cases: [string, unknown, RegExp][] = [
    ["pan", "ABC123", /PAN must look like AAAAA9999A/],
    ["pan", PAN_CO, /not a proprietorship PAN/], // right shape, company holder status on a proprietorship
    ["gstin", badChecksum, /fails the checksum/],
    ["gstin", gstinFor("29", PAN_CO), /belongs to PAN/],
    ["contactPhone", "98765", /Phone must be 10 digits/],
    ["contactEmail", "not-an-email", /Invalid email/],
    ["entityType", "PVT_LTD", /Correct the PAN first/],
    ["turnover", "", /Enter a value for turnover/],
    ["growthGoal", "WORLD_DOMINATION", /Pick one of the listed options/],
  ];
  it.each(cases)("%s = %j is refused", async (field, newValue, msg) => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "Client", id: "c-prop", field, newValue, reason: REASON }, deps(db));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(msg);
    }
    expect(audits(db)).toHaveLength(0);
    expect(row(db, "client", "c-prop").pan).toBe("ABCPK1234F");
  });

  it("refuses a PAN that already belongs to another client", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "Client", id: "c-prospect", field: "pan", newValue: "ABCPK1234F", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/already belongs to Kumar Traders/);
  });
});

describe("one transaction: update + masked audit", () => {
  it("updates the column and writes AuditEvent 'correct' with masked before / after and a scrubbed reason", async () => {
    const db = world();
    const r = await correctField(
      USERS.admin,
      { entity: "Client", id: "c-prop", field: "contactPhone", newValue: "9811112222", reason: "Client wrote 9811112222 on the form; PAN ABCPK1234F" },
      deps(db),
    );
    expect(r.ok).toBe(true);
    expect(row(db, "client", "c-prop").contactPhone).toBe("9811112222");
    const [ev] = audits(db);
    expect(ev).toMatchObject({ action: "correct", entity: "Client", entityId: "c-prop", actorId: USERS.admin.id });
    expect(ev.meta).toMatchObject({ field: "contactPhone", label: "contact phone", before: "****3210", after: "****2222" });
    const raw = JSON.stringify(ev.meta);
    expect(raw).not.toContain("9876543210");
    expect(raw).not.toContain("9811112222");
    expect(raw).not.toContain("ABCPK1234F");
    expect((ev.meta as Row).reason).toMatch(/⟨PHONE_1⟩.*⟨PAN_1⟩/);
    expect(db.calls).toContain("$transaction");
  });

  it("masks PAN, email and names, and records free text by length only", async () => {
    const db = world();
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "pan", newValue: "ABCPK5678G", reason: REASON }, deps(db));
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "contactEmail", newValue: "kiran.k@kumartraders.test", reason: REASON }, deps(db));
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "contactName", newValue: "Kiran K Kumar", reason: REASON }, deps(db));
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "growthNote", newValue: "Plans a franchise", reason: REASON }, deps(db));
    const metas = audits(db).map((e) => e.meta as Row);
    expect(metas[0]).toMatchObject({ before: "****234F", after: "****678G" });
    expect(metas[1]).toMatchObject({ before: "****test", after: "****test" });
    expect(metas[2]).toMatchObject({ before: "K. K.", after: "K. K. K." });
    expect(String(metas[3].before)).toMatch(/^\[text, 27 characters, #[0-9a-f]{6}\]$/);
    expect(JSON.stringify(metas)).not.toMatch(/kiran@|Kiran Kumar|second shop|franchise/);
  });

  it("rolls the update back when the audit write fails", async () => {
    const db = world();
    const failing = new Proxy(db, {
      get: (t, k) => {
        if (k === "$transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            (t.$transaction as (f: (tx: unknown) => Promise<unknown>) => Promise<unknown>)((tx) =>
              fn(new Proxy(tx as object, { get: (tt, kk) => (kk === "auditEvent" ? { create: async () => Promise.reject(new Error("db down")) } : (tt as Record<string | symbol, unknown>)[kk]) })),
            );
        }
        return (t as unknown as Record<string | symbol, unknown>)[k];
      },
    });
    await expect(correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: REASON }, deps(failing as MemoryDb))).rejects.toThrow("db down");
    expect(row(db, "client", "c-prop").city).toBe("Bengaluru");
  });

  it("keeps the turnover band in step with a corrected turnover", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "Client", id: "c-prop", field: "turnover", newValue: "25000000", reason: REASON }, deps(db));
    expect(r.ok).toBe(true);
    expect(row(db, "client", "c-prop")).toMatchObject({ turnover: 25_000_000, turnoverBand: "CR1_TO_5CR" });
  });

  it("refuses a value that is already on record", async () => {
    const db = world();
    const r = await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "city", newValue: "Bengaluru", reason: REASON }, deps(db));
    expect(r).toEqual({ ok: false, status: 400, error: SAME_VALUE_MESSAGE });
  });

  it("runs the after-commit hook and never fails the correction when the hook fails", async () => {
    const db = world();
    const afterCommit = vi.fn().mockRejectedValue(new Error("workbook unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "industry", newValue: "Wholesale", reason: REASON }, deps(db, { afterCommit }));
    expect(r.ok).toBe(true);
    expect(afterCommit).toHaveBeenCalledWith(expect.objectContaining({ entity: "Client", field: "industry", before: "Retail", after: "Wholesale" }));
  });

  it("returns 404 with a plain sentence for a missing record", async () => {
    const db = world();
    const r = await correctField(USERS.admin, { entity: "JobTask", id: "nope", field: "title", newValue: "GSTR-1", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 404 });
    if (!r.ok) expect(r.error).toMatch(/^That job wasn't found\./);
  });
});

describe("permission matrix", () => {
  type Case = [string, keyof typeof USERS, string, string, string, unknown, number | "ok"];
  const cases: Case[] = [
    ["client master: admin", "admin", "Client", "c-prop", "city", "Hubballi", "ok"],
    ["client master: partner", "partner", "Client", "c-prop", "city", "Hubballi", "ok"],
    ["client master: manager", "manager", "Client", "c-prop", "city", "Hubballi", 403],
    ["client master: staff", "staff", "Client", "c-prop", "city", "Hubballi", 403],
    ["firm client: partner", "partner", "FirmClient", "fc-prop", "turiaClientRef", "T-101", "ok"],
    ["firm client: manager", "manager", "FirmClient", "fc-prop", "turiaClientRef", "T-101", 403],
    ["job dates: partner", "partner", "JobTask", "j-assigned", "internalDueOn", "2026-11-18", "ok"],
    ["job dates: assignee's manager", "manager", "JobTask", "j-assigned", "internalDueOn", "2026-11-18", "ok"],
    ["job dates: another manager", "otherManager", "JobTask", "j-assigned", "internalDueOn", "2026-11-18", 403],
    ["job dates: admin who is not a partner", "admin", "JobTask", "j-assigned", "internalDueOn", "2026-11-18", 403],
    ["job dates: the assignee", "staff", "JobTask", "j-assigned", "internalDueOn", "2026-11-18", 403],
    ["engagement: assignee's manager", "manager", "Engagement", "e-gst", "frequency", "QUARTERLY", "ok"],
    ["engagement: reviewer", "reviewer", "Engagement", "e-gst", "frequency", "QUARTERLY", 403],
    ["draft: creator", "staff", "CommsDraft", "d-new", "subject", "October GST documents", "ok"],
    ["draft: partner", "partner", "CommsDraft", "d-new", "subject", "October GST documents", 403],
    ["draft: admin", "admin", "CommsDraft", "d-new", "subject", "October GST documents", 403],
    ["inactive admin", "inactive", "Client", "c-prop", "city", "Hubballi", 401],
  ];
  it.each(cases)("%s", async (_name, who, entity, id, field, newValue, expected) => {
    const db = world();
    const r = await correctField(USERS[who], { entity, id, field, newValue, reason: REASON }, deps(db));
    if (expected === "ok") {
      expect(r.ok).toBe(true);
      expect(audits(db)).toHaveLength(1);
    } else {
      expect(r).toMatchObject({ ok: false, status: expected });
      if (!r.ok) expect(r.error).toMatch(/^(Only|Sign in)/);
      expect(audits(db)).toHaveLength(0);
    }
  });
});

describe("record rules", () => {
  it("refuses a client code change once the CL- site exists, and explains the folder implication", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "FirmClient", id: "fc-co", field: "clientCode", newValue: "ZENITH2", reason: REASON }, deps(db));
    expect(r).toEqual({ ok: false, status: 409, error: SITE_EXISTS_MESSAGE });
    expect(SITE_EXISTS_MESSAGE).toMatch(/already has a SharePoint site.*Ask IT to rename the site first/s);
    expect(row(db, "firmClient", "fc-co").clientCode).toBe("ZENITH");
  });

  it("allows a client code change before the site exists, uppercases it and reminds about Turia", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "FirmClient", id: "fc-prop", field: "clientCode", newValue: "kumar01", reason: REASON }, deps(db));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toMatch(/Turia/);
    expect(row(db, "firmClient", "fc-prop").clientCode).toBe("KUMAR01");
  });

  it("refuses a client code another client already uses", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "FirmClient", id: "fc-prop", field: "clientCode", newValue: "ZENITH", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toBe("Client code ZENITH is already used by Zenith Components Pvt Ltd. Pick a different code.");
  });

  it("allows a period change only before IN_PREP and only inside the job's FY", async () => {
    const db = world();
    const late = await correctField(USERS.partner, { entity: "JobTask", id: "j-prep", field: "period", newValue: "2026-08", reason: REASON }, deps(db));
    expect(late).toMatchObject({ ok: false, status: 409 });
    if (!late.ok) expect(late.error).toMatch(/fixed once preparation starts \(the job is IN_PREP\)/);
    const outside = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "period", newValue: "2027-05", reason: REASON }, deps(db));
    expect(outside).toMatchObject({ ok: false, status: 400 });
    if (!outside.ok) expect(outside.error).toBe("Period 2027-05 is outside FY 2026-27. Pick a month from April 2026 to March 2027.");
    const good = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "period", newValue: "2026-11", reason: REASON }, deps(db));
    expect(good.ok).toBe(true);
  });

  it("refuses a title + period that clashes with another job of the client", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "period", newValue: "2026-09", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/Another job for this client already has that title and period/);
  });

  it("refuses an internal due date after the statutory due date", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "internalDueOn", newValue: "2026-11-21", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toBe("The internal due date can't be after the statutory due date (20 Nov 2026). Pick an earlier date.");
  });

  it("stores a corrected internal due date as 00:00 IST of the picked day", async () => {
    const db = world();
    await correctField(USERS.manager, { entity: "JobTask", id: "j-assigned", field: "internalDueOn", newValue: "2026-11-18", reason: REASON }, deps(db));
    expect((row(db, "jobTask", "j-assigned").internalDueOn as Date).toISOString()).toBe("2026-11-17T18:30:00.000Z");
  });

  it("refuses corrections on a DONE job and on a draft already opened in Outlook", async () => {
    const db = world();
    const done = await correctField(USERS.partner, { entity: "JobTask", id: "j-done", field: "title", newValue: "AOC-4 XBRL", reason: REASON }, deps(db));
    expect(done).toMatchObject({ ok: false, status: 409 });
    if (!done.ok) expect(done.error).toMatch(/This job is DONE/);
    const opened = await correctField(USERS.staff, { entity: "CommsDraft", id: "d-opened", field: "body", newValue: "Updated", reason: REASON }, deps(db));
    expect(opened).toMatchObject({ ok: false, status: 409 });
    if (!opened.ok) expect(opened.error).toMatch(/already been opened in Outlook, so correct it in Outlook/);
  });

  it("checks people: active, a person (not a mailbox), and not both assignee and reviewer", async () => {
    const db = world();
    const left = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "assigneeId", newValue: "u-left", reason: REASON }, deps(db));
    expect(left).toMatchObject({ ok: false, status: 400, error: "That person isn't an active user. Pick someone from the list." });
    const mailbox = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "assigneeId", newValue: "u-mailbox", reason: REASON }, deps(db));
    expect(mailbox).toMatchObject({ ok: false, status: 400 });
    const same = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "assigneeId", newValue: USERS.reviewer.id, reason: REASON }, deps(db));
    expect(same).toMatchObject({ ok: false, status: 400, error: "The assignee and the reviewer must be different people. Pick someone else." });
    const good = await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "assigneeId", newValue: USERS.manager.id, reason: REASON }, deps(db));
    expect(good.ok).toBe(true);
  });

  it("refuses an engagement frequency the service cannot run at", async () => {
    const db = world();
    const r = await correctField(USERS.partner, { entity: "Engagement", id: "e-gst", field: "frequency", newValue: "ANNUAL", reason: REASON }, deps(db));
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toBe("A GST engagement can be monthly or quarterly, not annual. Pick one of those.");
  });

  it("records the privacy request a correction answers", async () => {
    const db = world();
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: REASON, privacyRequestId: "pr-1" }, deps(db));
    expect(audits(db)[0].meta).toMatchObject({ privacyRequestId: "pr-1" });
  });

  it("never removes anything", async () => {
    const db = world();
    for (const [entity, id, field, value] of [
      ["Client", "c-prop", "city", "Hubballi"],
      ["FirmClient", "fc-prop", "preferredLanguage", "ta"],
      ["JobTask", "j-assigned", "title", "GSTR-3B (Oct)"],
      ["CommsDraft", "d-new", "body", "Dear client, please share the register."],
    ] as const) {
      const who = entity === "CommsDraft" ? USERS.staff : USERS.partner;
      await correctField(who, { entity, id, field, newValue: value, reason: REASON }, deps(db));
    }
    expect(removalCalls(db.calls)).toEqual([]);
    expect(db.tables.client).toHaveLength(3);
    expect(audits(db)).toHaveLength(4);
  });
});

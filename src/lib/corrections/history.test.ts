import { describe, expect, it } from "vitest";
import { correctField, type CorrectionsDb } from "./service";
import { displayValue, loadCorrectionHistory, type HistoryDb } from "./history";
import { maskForAudit, maskLast4, maskName, maskText, scrubFreeText } from "./mask";
import { USERS, world } from "@/lib/privacy/__tests__/fixtures";
import type { MemoryDb } from "@/lib/privacy/__tests__/memory-db";

const REASON = "Entered against the wrong client";
const cdeps = (db: MemoryDb) => ({ db: db as unknown as CorrectionsDb });
const hdeps = (db: MemoryDb) => ({ db: db as unknown as HistoryDb });

describe("correction history", () => {
  it("lists who, when, field, before → after and reason, newest first, in words", async () => {
    let t = new Date("2026-11-05T05:30:00.000Z");
    const db = world(() => t);
    await correctField(USERS.manager, { entity: "JobTask", id: "j-assigned", field: "internalDueOn", newValue: "2026-11-18", reason: REASON }, cdeps(db));
    t = new Date("2026-11-05T09:00:00.000Z");
    await correctField(USERS.partner, { entity: "JobTask", id: "j-assigned", field: "reviewerId", newValue: USERS.otherManager.id, reason: REASON }, cdeps(db));

    const r = await loadCorrectionHistory(USERS.staff, { entity: "JobTask", id: "j-assigned" }, hdeps(db));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.entries.map((e) => e.label)).toEqual(["reviewer", "internal due date"]);
    expect(r.data.entries[0]).toMatchObject({ actorName: "Lakshmi Partner", before: "Ravi Reviewer", after: "Meera Manager", atLabel: "05 Nov 2026 14:30", reason: REASON });
    expect(r.data.entries[1]).toMatchObject({ actorName: "Mohan Manager", before: "17 Nov 2026", after: "18 Nov 2026", atLabel: "05 Nov 2026 11:00" });
    // The assignee may look but not correct.
    expect(r.data.editable).toEqual([]);
    expect(r.data.people).toEqual([]);
  });

  it("offers only the fields this person may correct, with the people list when a person field is editable", async () => {
    const db = world();
    const r = await loadCorrectionHistory(USERS.manager, { entity: "JobTask", id: "j-assigned" }, hdeps(db));
    expect(r.ok && r.data.editable.map((f) => f.field)).toEqual(["internalDueOn", "assigneeId", "reviewerId", "title", "period"]);
    if (!r.ok) return;
    const names = r.data.people.map((p) => p.name);
    expect(names).toContain("Priya Staff");
    expect(names).not.toContain("Accounts Mailbox");
    expect(names).not.toContain("Former Staff");

    const client = await loadCorrectionHistory(USERS.admin, { entity: "Client", id: "c-prop" }, hdeps(db));
    expect(client.ok && client.data.editable.find((f) => f.field === "entityType")?.options?.length).toBeGreaterThan(5);
    const draft = await loadCorrectionHistory(USERS.staff, { entity: "CommsDraft", id: "d-new" }, hdeps(db));
    expect(draft.ok && draft.data.editable.map((f) => f.field)).toEqual(["subject", "body"]);
  });

  it("shows masked values for client personal data", async () => {
    const db = world();
    await correctField(USERS.admin, { entity: "Client", id: "c-prop", field: "contactPhone", newValue: "9811112222", reason: REASON }, cdeps(db));
    const r = await loadCorrectionHistory(USERS.staff, { entity: "Client", id: "c-prop" }, hdeps(db));
    expect(r.ok && r.data.entries[0]).toMatchObject({ before: "****3210", after: "****2222" });
  });

  it("refuses people who may not see the record, and unknown records, with plain sentences", async () => {
    const db = world();
    const outsider = await loadCorrectionHistory(USERS.reviewer, { entity: "JobTask", id: "j-prep" }, hdeps(db));
    expect(outsider.ok).toBe(true); // the job's reviewer
    const draft = await loadCorrectionHistory(USERS.reviewer, { entity: "CommsDraft", id: "d-new" }, hdeps(db));
    expect(draft).toMatchObject({ ok: false, status: 403 });
    const missing = await loadCorrectionHistory(USERS.admin, { entity: "JobTask", id: "nope" }, hdeps(db));
    expect(missing).toMatchObject({ ok: false, status: 404 });
    const bad = await loadCorrectionHistory(USERS.admin, { entity: "Payroll", id: "x" }, hdeps(db));
    expect(bad).toMatchObject({ ok: false, status: 400 });
    const inactive = await loadCorrectionHistory(USERS.inactive, { entity: "Client", id: "c-prop" }, hdeps(db));
    expect(inactive).toMatchObject({ ok: false, status: 403 });
  });

  it("puts values into words", () => {
    const names = new Map([["u-1", "Priya"]]);
    expect(displayValue("Client", "city", null, names)).toBe("(empty)");
    expect(displayValue("Client", "entityType", "PVT_LTD", names)).toBe("Private limited");
    expect(displayValue("FirmClient", "preferredLanguage", "kn", names)).toBe("Kannada");
    expect(displayValue("Client", "turnover", 12345678, names)).toBe("1,23,45,678");
    expect(displayValue("JobTask", "assigneeId", "u-1", names)).toBe("Priya");
    expect(displayValue("JobTask", "assigneeId", "u-x", names)).toBe("(a former user)");
    expect(displayValue("Client", "onboardedOn", "2024-04-01T00:00:00.000Z", names)).toBe("01 Apr 2024");
  });
});

describe("audit masking", () => {
  it("keeps only the last four characters of identifiers, behind a fixed-length mask", () => {
    expect(maskLast4("ABCPK1234F")).toBe("****234F");
    expect(maskLast4("123456789012")).toBe("****9012");
    expect(maskLast4("abc")).toBe("****");
    expect(maskForAudit("aadhaar", "234567890123")).toBe("****0123");
    expect(maskForAudit("email", "kiran@kumartraders.test")).toBe("****test");
    expect(maskForAudit("phone", 9876543210)).toBe("****3210");
  });

  it("names become initials, free text a length and fingerprint, dates ISO, blanks null", () => {
    expect(maskName("  priya   raman ")).toBe("P. R.");
    expect(maskText("hello")).toMatch(/^\[text, 5 characters, #[0-9a-f]{6}\]$/);
    expect(maskText("hello")).not.toBe(maskText("hellp"));
    expect(maskForAudit(undefined, new Date("2026-11-05T00:00:00.000Z"))).toBe("2026-11-05T00:00:00.000Z");
    expect(maskForAudit(undefined, new Date("bad"))).toBeNull();
    expect(maskForAudit(undefined, "  ")).toBeNull();
    expect(maskForAudit(undefined, undefined)).toBeNull();
    expect(maskForAudit(undefined, 42)).toBe(42);
    expect(maskForAudit(undefined, true)).toBe(true);
    expect(String(maskForAudit(undefined, "x".repeat(300))).length).toBe(200);
  });

  it("scrubs identifiers out of free-text reasons", () => {
    const out = scrubFreeText("PAN ABCPK1234F, mail kiran@kumartraders.test, phone 9876543210");
    expect(out).not.toMatch(/ABCPK1234F|kiran@|9876543210/);
    expect(out).toContain("⟨PAN_1⟩");
  });
});

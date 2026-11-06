// /admin/firm-os/turia-sync saves and page data: who may, what is valid, and an AuditEvent for each save.
import { describe, expect, it } from "vitest";
import { createPullWorld } from "../../../../../tests/fakes/turia-pull-world";
import { MANAGERS_ONLY, loadTuriaSyncPage, saveClientLink, savePersonLink, saveRule } from "./admin";
import { SEED_RULES } from "./rules";

const user = (over: Record<string, unknown> = {}) => ({ id: "u-admin", name: "Asha", email: "a@x.test", role: "ADMIN", level: "STAFF", active: true, ...over }) as never;
const staff = user({ id: "u-staff", role: "USER", level: "STAFF" });
const partner = user({ id: "u-partner", role: "USER", level: "PARTNER" });

function world() {
  const w = createPullWorld();
  w.seedFirm();
  w.db.turiaPersonLink.rows.push({ turiaUserId: "t-new", turiaName: "N Kumar", turiaEmail: null, userId: null, matchedBy: "none", lastSeenAt: new Date() });
  w.db.turiaClientLink.rows.push({ key: "gamma exports", turiaName: "Gamma Exports", turiaCode: null, lmsClientId: null, firmClientId: null, status: "unmatched", lastSeenAt: new Date() });
  return w;
}

const rule = { position: 5, label: "Payroll", department: null, namePattern: "payroll|salary", service: "Books" as const, title: "Payroll", frequency: "MONTHLY" as const, useAgent: false, calendarRuleId: null, active: true };

describe("people", () => {
  it("staff, inactive people and signed-out callers may not save", async () => {
    const w = world();
    for (const who of [staff, user({ active: false }), null]) expect(await savePersonLink(w.adminDb, who, { turiaUserId: "t-new", userId: "u-priya" })).toEqual({ ok: false, status: 403, error: MANAGERS_ONLY });
    expect(w.db.auditEvent.rows).toHaveLength(0);
  });

  it("a pick is saved as manual and audited; null goes back to automatic", async () => {
    const w = world();
    expect(await savePersonLink(w.adminDb, partner, { turiaUserId: "t-new", userId: "u-priya" })).toEqual({ ok: true, data: { turiaUserId: "t-new", userId: "u-priya" } });
    expect(w.db.turiaPersonLink.rows[0]).toMatchObject({ userId: "u-priya", matchedBy: "manual", updatedById: "u-partner" });
    expect(w.db.auditEvent.rows[0]).toMatchObject({ actorId: "u-partner", action: "turia-pull.person-link", entity: "TuriaPersonLink", entityId: "t-new", meta: { from: null, to: "u-priya", matchedBy: "manual" } });
    await savePersonLink(w.adminDb, partner, { turiaUserId: "t-new", userId: null });
    expect(w.db.turiaPersonLink.rows[0]).toMatchObject({ userId: null, matchedBy: "none" });
  });

  it("an unknown Turia person or an inactive LMS user is refused with a plain sentence", async () => {
    const w = world();
    expect(await savePersonLink(w.adminDb, user(), { turiaUserId: "nope", userId: null })).toMatchObject({ ok: false, status: 404 });
    expect(await savePersonLink(w.adminDb, user(), { turiaUserId: "t-new", userId: "u-old" })).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/no longer active/) });
  });
});

describe("clients", () => {
  it("link, ignore and back to automatic, each audited", async () => {
    const w = world();
    expect(await saveClientLink(w.adminDb, user(), { key: "gamma exports", action: "link", lmsClientId: "c-acme" })).toEqual({ ok: true, data: { key: "gamma exports", status: "manual" } });
    expect(w.db.turiaClientLink.rows[0]).toMatchObject({ status: "manual", lmsClientId: "c-acme", firmClientId: "fc-acme" });
    await saveClientLink(w.adminDb, user(), { key: "gamma exports", action: "ignore" });
    expect(w.db.turiaClientLink.rows[0]).toMatchObject({ status: "ignored", lmsClientId: null, firmClientId: null });
    await saveClientLink(w.adminDb, user(), { key: "gamma exports", action: "auto" });
    expect(w.db.turiaClientLink.rows[0]).toMatchObject({ status: "unmatched" });
    expect(w.db.auditEvent.rows.map((a) => a.action)).toEqual(["turia-pull.client-link", "turia-pull.client-link", "turia-pull.client-link"]);
  });

  it("refuses a missing pick, an unknown client, an unknown link and staff", async () => {
    const w = world();
    expect(await saveClientLink(w.adminDb, user(), { key: "gamma exports", action: "link" })).toMatchObject({ ok: false, status: 400, error: "Choose the client to link, then save." });
    expect(await saveClientLink(w.adminDb, user(), { key: "gamma exports", action: "link", lmsClientId: "c-none" })).toMatchObject({ ok: false, status: 400 });
    expect(await saveClientLink(w.adminDb, user(), { key: "nope", action: "ignore" })).toMatchObject({ ok: false, status: 404 });
    expect(await saveClientLink(w.adminDb, staff, { key: "gamma exports", action: "ignore" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("rules", () => {
  it("adding a rule saves the seeds first, then the rule, audited", async () => {
    const w = world();
    const r = await saveRule(w.adminDb, user(), rule);
    expect(r.ok).toBe(true);
    expect(w.db.turiaTaskRule.rows).toHaveLength(SEED_RULES.length + 1);
    expect(w.db.auditEvent.rows[0]).toMatchObject({ action: "turia-pull.rule-add", entity: "TuriaTaskRule" });
  });

  it("changing a rule (and switching it off) is audited with before and after; rules are never removed", async () => {
    const w = world();
    await saveRule(w.adminDb, user(), rule);
    const r = await saveRule(w.adminDb, user(), { ...rule, id: "seed-gstr-1", label: "GSTR-1", namePattern: "gstr 1", service: "GST", title: "GSTR-1", useAgent: true, active: false, department: "  ", calendarRuleId: " gstr-1 " });
    expect(r).toEqual({ ok: true, data: { id: "seed-gstr-1" } });
    expect(w.db.turiaTaskRule.rows.find((x) => x.id === "seed-gstr-1")).toMatchObject({ active: false, department: null, calendarRuleId: "gstr-1", position: 5 });
    expect(w.db.auditEvent.rows[1]).toMatchObject({ action: "turia-pull.rule-change", entityId: "seed-gstr-1", meta: { before: expect.objectContaining({ active: true }), after: expect.objectContaining({ active: false }) } });
    expect(w.db.turiaTaskRule.rows).toHaveLength(SEED_RULES.length + 1);
  });

  it("refuses an empty pattern, an unknown rule and staff", async () => {
    const w = world();
    expect(await saveRule(w.adminDb, user(), { ...rule, namePattern: " | + " })).toMatchObject({ ok: false, status: 400 });
    expect(await saveRule(w.adminDb, user(), { ...rule, id: "nope" })).toMatchObject({ ok: false, status: 404 });
    expect(await saveRule(w.adminDb, staff, rule)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("page data", () => {
  it("mode, sign-in freshness, unmatched first, the starting rules before the first save", async () => {
    const w = world();
    w.db.turiaPersonLink.rows.push({ turiaUserId: "t-priya", turiaName: "Priya", turiaEmail: "p@x", userId: "u-priya", matchedBy: "email", lastSeenAt: new Date() });
    w.db.turiaPullRun.rows.push({ id: "r1", mode: "dry-run", trigger: "cron", status: "ok", message: "Read", complete: true, counts: { fetched: 3 }, preview: [{ action: "create", task: "T", client: "C", detail: "D" }], startedAt: new Date("2026-11-06T04:00:00Z") });
    const now = new Date("2026-11-06T05:30:00Z");
    const p = await loadTuriaSyncPage(w.adminDb, { present: true, updatedAt: new Date("2026-11-06T05:20:00Z") }, now, { FIRM_OS_ENABLED: "true", FIRM_OS_TURIA_PULL: "dry-run" });
    expect(p).toMatchObject({ firmOsOn: true, mode: "dry-run", modeValid: true, session: { present: true, fresh: true }, rulesSaved: false, jobs: { fromTuria: 0, flagged: 0 } });
    expect(p.lastRun).toMatchObject({ id: "r1", when: "06 Nov 2026 09:30 IST", counts: { fetched: 3 }, preview: [{ action: "create" }] });
    expect(p.people.map((x) => x.turiaUserId)).toEqual(["t-new", "t-priya"]);
    expect(p.people[1]).toMatchObject({ userName: "Priya S" });
    expect(p.clients[0]).toMatchObject({ key: "gamma exports", status: "unmatched", firmOs: false });
    expect(p.rules).toHaveLength(SEED_RULES.length);
    expect(p.rules.find((r) => r.id === "seed-tds-24q")).toMatchObject({ hasAgent: false, serviceLabel: "TDS" });
    expect(p.users.map((u) => u.id)).not.toContain("u-old");
    const stale = await loadTuriaSyncPage(w.adminDb, { present: true, updatedAt: new Date("2026-11-06T04:00:00Z") }, now, {});
    expect(stale).toMatchObject({ mode: "off", firmOsOn: false, session: { fresh: false } });
  });
});

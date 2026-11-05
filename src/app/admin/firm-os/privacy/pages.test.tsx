// /admin/firm-os/privacy and /admin/firm-os/breaches render for an admin (empty and with data),
// send everyone else away, and appear in the admin sidebar's Firm OS group.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, NotFoundSignal, redirectTarget, renderHtml } from "../../../../../tests/unit/routes/harness";
import { createMemoryDb, type MemoryDb } from "@/lib/privacy/__tests__/memory-db";
import { PAN_PROP, T0, USERS, privacyWorld } from "@/lib/privacy/__tests__/fixtures";
import { createRequest, verifyIdentity, type PrivacyDeps } from "@/lib/privacy/register";
import { recordBreach } from "@/lib/privacy/breach";
import type { PrivacyDb } from "@/lib/privacy/inventory";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => (state.db as Record<string | symbol, unknown>)[k] }) }));
vi.mock("next/navigation", async () => (await import("../../../../../tests/unit/routes/harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: PrivacyPage } = await import("@/app/admin/firm-os/privacy/page");
const { default: PrivacyRequestPage } = await import("@/app/admin/firm-os/privacy/[id]/page");
const { default: BreachesPage } = await import("@/app/admin/firm-os/breaches/page");
const { default: BreachPage } = await import("@/app/admin/firm-os/breaches/[id]/page");
const { default: AdminLayout } = await import("@/app/admin/layout");

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const deps = (db: MemoryDb): PrivacyDeps => ({ db: db as unknown as PrivacyDb, now: () => new Date(), hashKey: "k" });
const clean = (html: string) => html.replace(/<!-- -->/g, "");

async function request(db: MemoryDb, kind: string, identifiers: Record<string, string>, opts: { receivedOn?: string; verify?: boolean } = {}) {
  const r = await createRequest(USERS.admin, { kind, identifiers, receivedOn: opts.receivedOn }, deps(db));
  if (!r.ok) throw new Error(r.error);
  if (opts.verify) await verifyIdentity(USERS.admin, r.data.id, { method: "Photo ID seen in person" }, deps(db));
  return r.data.id;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  signedIn(activeSession({ role: "ADMIN", id: USERS.admin.id }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("/admin/firm-os/privacy", () => {
  it("renders the empty register with tiles, the log form and filters", async () => {
    state.db = createMemoryDb();
    const html = clean(await renderHtml(await PrivacyPage(sp())));
    expect(html).toContain("Privacy requests");
    expect(html).toContain("Admin · Firm OS");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Log a request");
    expect(html).toContain("No privacy requests match these filters.");
    expect(html).toContain("Due within 7 days");
    expect(html).toContain("partner or");
  });

  it("lists requests with masked people, due dates and overdue in red, never raw identifiers", async () => {
    const db = privacyWorld();
    state.db = db;
    await request(db, "access", { pan: PAN_PROP }, { receivedOn: "2026-09-01" });
    await request(db, "grievance", { email: "kiran@kumartraders.test" });
    const html = clean(await renderHtml(await PrivacyPage(sp())));
    expect(html).toContain("Access to personal data");
    expect(html).toContain("K. T. · KUMAR1 · PAN ****234F");
    expect(html).toContain("01 Oct 2026");
    expect(html).toContain("Overdue");
    expect(html).toContain("text-red-700");
    expect(html).toContain("05 Dec 2026");
    expect(html).not.toContain(PAN_PROP);
    expect(html).not.toContain("kiran@kumartraders.test");
    const filtered = clean(await renderHtml(await PrivacyPage(sp({ overdue: "1" }))));
    expect(filtered).not.toContain("Grievance</a>");
  });

  it("shows the erasure plan item by item with hold dates, verify notes and a confirm step", async () => {
    const db = privacyWorld();
    state.db = db;
    const id = await request(db, "erasure", { pan: PAN_PROP }, { verify: true });
    const html = clean(await renderHtml(await PrivacyRequestPage(idp(id))));
    expect(html).toContain("Erasure plan");
    expect(html).toContain("Nothing is deleted.");
    expect(html).toContain("Legal hold");
    expect(html).toContain("Anonymise");
    expect(html).toContain("Manual step");
    expect(html).toContain("Until the engagement ends, and at least until 01 Apr 2035");
    expect(html).toContain("Partner/legal to verify");
    expect(html).toContain("Erase personal data…");
    expect(html).toContain('href="/admin/firm-os/privacy"');
    expect(html).not.toContain(PAN_PROP);
  });

  it("asks for identity first, then offers the export download for an access request", async () => {
    const db = privacyWorld();
    state.db = db;
    const id = await request(db, "access", { pan: PAN_PROP });
    const before = clean(await renderHtml(await PrivacyRequestPage(idp(id))));
    expect(before).toContain("Mark identity verified");
    expect(before).not.toContain("Download export");
    await verifyIdentity(USERS.admin, id, { method: "Photo ID seen in person" }, deps(db));
    const after = clean(await renderHtml(await PrivacyRequestPage(idp(id))));
    expect(after).toContain(`href="/api/firm-os/privacy/requests/${id}/export"`);
    expect(after).toContain("Download export (JSON)");
    expect(after).toContain("Firm OS and the LMS client master hold");
  });

  it("renders the correction, consent, nomination and grievance steps", async () => {
    const db = privacyWorld();
    state.db = db;
    const correction = await request(db, "correction", { pan: PAN_PROP }, { verify: true });
    expect(clean(await renderHtml(await PrivacyRequestPage(idp(correction))))).toContain("Client master: history and corrections");
    const consent = await request(db, "consent-withdrawal", { pan: PAN_PROP }, { verify: true });
    const c = clean(await renderHtml(await PrivacyRequestPage(idp(consent))));
    expect(c).toContain("No new AI processing");
    expect(c).toContain("Restrict processing…");
    const nomination = await request(db, "nomination", { pan: PAN_PROP }, { verify: true });
    expect(clean(await renderHtml(await PrivacyRequestPage(idp(nomination))))).toContain("Record nominee");
    const grievance = await request(db, "grievance", { email: "kiran@kumartraders.test" });
    expect(clean(await renderHtml(await PrivacyRequestPage(idp(grievance))))).toContain("Send reply and close");
  });

  it("is admin only, and an unknown request is not found", async () => {
    state.db = createMemoryDb();
    await expect(PrivacyRequestPage(idp("nope"))).rejects.toBeInstanceOf(NotFoundSignal);
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await redirectTarget(() => PrivacyPage(sp()))).toBe("/dashboard");
    expect(await redirectTarget(() => PrivacyRequestPage(idp("x")))).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => PrivacyPage(sp()))).toBe("/");
  });
});

describe("/admin/firm-os/breaches", () => {
  it("renders the empty register with the runbook link", async () => {
    state.db = createMemoryDb();
    const html = clean(await renderHtml(await BreachesPage()));
    expect(html).toContain("Breach register");
    expect(html).toContain("No breaches recorded.");
    expect(html).toContain("docs/runbooks/breach.md");
    expect(html).toMatch(/target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain("Record an incident");
  });

  it("shows hours remaining on each open incident, and overdue in red", async () => {
    const db = createMemoryDb({ now: () => new Date() });
    db.seed("user", [{ id: USERS.admin.id, name: "Asha Admin", email: "asha@indefine.test", active: true }]);
    state.db = db;
    const bdeps = { db: db as unknown as PrivacyDb, now: () => new Date() };
    // T0 is 05 Nov 2026 11:00 IST
    const fresh = await recordBreach(USERS.admin, { detectedAt: "2026-11-05T09:00", summary: "Shared folder link sent to the wrong client", severity: "medium" }, bdeps);
    const old = await recordBreach(USERS.admin, { detectedAt: "2026-11-01T09:00", summary: "Phishing reply exposed a client contact list", severity: "high", affectedCount: 40 }, bdeps);
    const html = clean(await renderHtml(await BreachesPage()));
    expect(html).toContain("70 h left");
    expect(html).toContain("26 h overdue");
    expect(html).toMatch(/text-red-700[^"]*">26 h overdue/);
    expect(html).toContain("Board reports overdue");
    if (!fresh.ok || !old.ok) throw new Error("setup");
    const detail = clean(await renderHtml(await BreachPage(idp(old.data.id))));
    expect(detail).toContain("Next step");
    expect(detail).toContain("Legal to verify");
    expect(detail).toContain("40 people affected");
    expect(detail).toContain('href="/admin/firm-os/breaches"');
  });

  it("is admin only, and an unknown incident is not found", async () => {
    state.db = createMemoryDb();
    await expect(BreachPage(idp("nope"))).rejects.toBeInstanceOf(NotFoundSignal);
    signedIn(activeSession({ level: "MANAGER" }));
    expect(await redirectTarget(() => BreachesPage())).toBe("/dashboard");
    expect(await redirectTarget(() => BreachPage(idp("x")))).toBe("/dashboard");
  });
});

describe("admin sidebar", () => {
  it("lists both pages in the Firm OS group of both menus", async () => {
    const html = clean(await renderHtml(await AdminLayout({ children: null })));
    for (const [href, label] of [
      ["/admin/firm-os/privacy", "Privacy requests"],
      ["/admin/firm-os/breaches", "Breach register"],
    ]) {
      expect(html.split(`href="${href}"`).length - 1).toBe(2);
      expect(html).toContain(`${label}</a>`);
    }
    expect(html.indexOf(">Firm OS</p>")).toBeLessThan(html.indexOf('href="/admin/firm-os/privacy"'));
  });
});

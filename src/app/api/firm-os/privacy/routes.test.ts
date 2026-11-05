// Route handlers under /api/firm-os/privacy/** and /api/firm-os/corrections/**: auth → zod → one
// lib call → JSON. Signed out is 401, people who may not act get 403, every error is a sentence.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "../../../../../tests/unit/routes/harness";
import { PAN_PROP, USERS, privacyWorld } from "@/lib/privacy/__tests__/fixtures";
import { removalCalls, type MemoryDb } from "@/lib/privacy/__tests__/memory-db";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => (state.db as Record<string | symbol, unknown>)[k] }) }));
vi.mock("@/lib/clients/workbook", () => ({ scheduleWorkbookRebuild: vi.fn() }));

const { auth } = await import("@/lib/auth");
const requests = await import("@/app/api/firm-os/privacy/requests/route");
const verify = await import("@/app/api/firm-os/privacy/requests/[id]/verify/route");
const exportRoute = await import("@/app/api/firm-os/privacy/requests/[id]/export/route");
const erasure = await import("@/app/api/firm-os/privacy/requests/[id]/erasure/route");
const close = await import("@/app/api/firm-os/privacy/requests/[id]/close/route");
const consent = await import("@/app/api/firm-os/privacy/requests/[id]/consent-withdrawal/route");
const nomination = await import("@/app/api/firm-os/privacy/requests/[id]/nomination/route");
const pcorrection = await import("@/app/api/firm-os/privacy/requests/[id]/correction/route");
const lift = await import("@/app/api/firm-os/privacy/requests/[id]/lift-restriction/route");
const resolve = await import("@/app/api/firm-os/privacy/requests/[id]/resolve/route");
const breaches = await import("@/app/api/firm-os/privacy/breaches/route");
const breach = await import("@/app/api/firm-os/privacy/breaches/[id]/route");
const corrections = await import("@/app/api/firm-os/corrections/route");
const history = await import("@/app/api/firm-os/corrections/history/route");

const as = (u: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? activeSession(u as never) : null);
const admin = { ...USERS.admin };
const post = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url = "http://x/api") => new Request(url);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

let db: MemoryDb;
beforeEach(() => {
  db = privacyWorld();
  state.db = db;
  as(admin);
});

async function logRequest(kind: string, identifiers: Record<string, string>) {
  const r = await requests.POST(post({ kind, identifiers }));
  expect(r.status).toBe(201);
  return String((await json(r)).id);
}

describe("privacy request routes", () => {
  it("401 signed out, 403 for staff, 400 with a sentence for a bad body, 201 for an admin", async () => {
    as(null);
    const out = await requests.POST(post({ kind: "access", identifiers: { pan: PAN_PROP } }));
    expect(out.status).toBe(401);
    expect(await json(out)).toEqual({ error: "Sign in to continue." });
    as(USERS.staff);
    const staff = await requests.POST(post({ kind: "access", identifiers: { pan: PAN_PROP } }));
    expect(staff.status).toBe(403);
    expect(String((await json(staff)).error)).toMatch(/^Only admins and partners/);
    as(admin);
    const bad = await requests.POST(post({ identifiers: {} }));
    expect(bad.status).toBe(400);
    expect(await json(bad)).toEqual({ error: "Pick the kind of request." });
    const junk = await requests.POST(new Request("http://x/api", { method: "POST", body: "not json" }));
    expect(junk.status).toBe(400);
    expect(String((await json(junk)).error)).toMatch(/\.$/);
    expect(await logRequest("access", { pan: PAN_PROP })).toMatch(/^privacyRequest-/);
  });

  it("verify → export downloads an attachment; before verification it is refused", async () => {
    const id = await logRequest("access", { pan: PAN_PROP });
    expect((await exportRoute.GET(get(), params(id))).status).toBe(409);
    const v = await verify.POST(post({ method: "Photo ID seen in person" }), params(id));
    expect(v.status).toBe(200);
    const res = await exportRoute.GET(get(), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="privacy-export-${id}.json"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.requestId).toBe(id);
    expect(JSON.stringify(body)).toContain(PAN_PROP);
    expect((await exportRoute.GET(get(), params("bad id!"))).status).toBe(400);
  });

  it("erasure plan and confirm; staff are refused", async () => {
    const id = await logRequest("erasure", { email: "lalitha@consult.test" });
    await verify.POST(post({ method: "Photo ID seen in person" }), params(id));
    const plan = await json(await erasure.GET(get(), params(id)));
    expect((plan.items as Record<string, unknown>[]).every((i) => !("set" in i))).toBe(true);
    as(USERS.staff);
    expect((await erasure.GET(get(), params(id))).status).toBe(403);
    expect((await erasure.POST(post({ fingerprint: plan.fingerprint }), params(id))).status).toBe(403);
    as(admin);
    const done = await erasure.POST(post({ fingerprint: plan.fingerprint }), params(id));
    expect(done.status).toBe(200);
    expect(await json(done)).toMatchObject({ status: "COMPLETED" });
    expect((await erasure.GET(get(), params("missing"))).status).toBe(404);
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("close, consent withdrawal, nomination and correction steps", async () => {
    const g = await logRequest("grievance", { email: "kiran@kumartraders.test" });
    expect((await close.POST(post({ outcome: "completed", note: "We have fixed the reminder emails." }), params(g))).status).toBe(200);
    const c = await logRequest("consent-withdrawal", { pan: PAN_PROP });
    expect((await consent.POST(post({}), params(c))).status).toBe(409);
    await verify.POST(post({ method: "Photo ID seen in person" }), params(c));
    expect((await consent.POST(post({}), params(c))).status).toBe(200);
    const n = await logRequest("nomination", { pan: PAN_PROP });
    await verify.POST(post({ method: "Photo ID seen in person" }), params(n));
    expect((await nomination.POST(post({ nomineeName: "Meena Kumar", relationship: "spouse", nomineeContact: "9000011111" }), params(n))).status).toBe(200);
    const k = await logRequest("correction", { pan: PAN_PROP });
    await verify.POST(post({ method: "Photo ID seen in person" }), params(k));
    const fixed = await pcorrection.POST(post({ entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Client moved office" }), params(k));
    expect(fixed.status).toBe(200);
    const notMine = await pcorrection.POST(post({ entity: "JobTask", id: "j-assigned", field: "title", newValue: "X", reason: "Client moved office" }), params(k));
    expect(notMine.status).toBe(400);
  });

  it("resolve: links a request to one of the records found; staff refused; a record not found refused", async () => {
    const a = db.tables.client.find((c) => c.id === "c-prop")!;
    db.seed("client", [{ ...a, id: "c-twin", name: "Twin Stores", folderName: "Twin Stores", pan: "ABCPT1111K", gstin: null }]);
    const r = await requests.POST(post({ kind: "access", identifiers: { phone: "9876543210" } }));
    const id = String((await json(r)).id);
    expect(db.tables.privacyRequest.find((x) => x.id === id)?.principalRef).toBeNull();
    as(USERS.staff);
    expect((await resolve.POST(post({ ref: "c-prop" }), params(id))).status).toBe(403);
    as(admin);
    expect((await resolve.POST(post({ ref: "c-co" }), params(id))).status).toBe(400);
    expect((await resolve.POST(post({}), params(id))).status).toBe(400);
    const ok = await resolve.POST(post({ ref: "c-twin" }), params(id));
    expect(ok.status).toBe(200);
    expect(db.tables.privacyRequest.find((x) => x.id === id)?.principalRef).toBe("c-twin");
  });

  it("lift restriction: partner only, with a reason; admins and staff get a sentence, not a lift", async () => {
    const c = await logRequest("consent-withdrawal", { pan: PAN_PROP });
    await verify.POST(post({ method: "Photo ID seen in person" }), params(c));
    expect((await consent.POST(post({}), params(c))).status).toBe(200);
    const reason = { reason: "Client gave written consent again on 05 Nov 2026" };
    const byAdmin = await lift.POST(post(reason), params(c));
    expect(byAdmin.status).toBe(403);
    expect(await json(byAdmin)).toEqual({ error: "Only a partner can lift a processing restriction. Ask a partner to review this request." });
    as(USERS.staff);
    expect((await lift.POST(post(reason), params(c))).status).toBe(403);
    as(null);
    expect((await lift.POST(post(reason), params(c))).status).toBe(401);
    as(USERS.partner);
    expect((await lift.POST(post({ reason: "ok" }), params(c))).status).toBe(400);
    const done = await lift.POST(post(reason), params(c));
    expect(done.status).toBe(200);
    expect(await json(done)).toMatchObject({ lifted: 1 });
    expect(db.tables.auditEvent.filter((e) => e.action === "lift-restriction").map((e) => e.actorId)).toEqual([USERS.partner.id, USERS.partner.id]);
    expect((await lift.POST(post(reason), params(c))).status).toBe(409); // nothing left to lift
    expect(removalCalls(db.calls)).toEqual([]);
  });
});

describe("breach routes", () => {
  it("records and steps an incident; staff are refused", async () => {
    as(USERS.staff);
    expect((await breaches.POST(post({ detectedAt: "2026-11-01T10:00", summary: "Laptop lost with client files", severity: "high" }))).status).toBe(403);
    as(admin);
    const created = await breaches.POST(post({ detectedAt: "2026-11-01T10:00", summary: "Laptop lost with client files", severity: "high" }));
    expect(created.status).toBe(201);
    const id = String((await json(created)).id);
    const step = await breach.POST(post({ action: "contain", note: "Device wiped remotely; passwords reset" }), params(id));
    expect(step.status).toBe(200);
    expect(await json(step)).toMatchObject({ status: "CONTAINED" });
    const bad = await breach.POST(post({ action: "explode" }), params(id));
    expect(bad.status).toBe(400);
    expect(String((await json(bad)).error)).toMatch(/^Some details in the request are missing/);
  });
});

describe("correction routes", () => {
  it("corrects an allow-listed field for management and refuses staff", async () => {
    as(USERS.staff);
    const refused = await corrections.POST(post({ entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Typed the wrong city" }));
    expect(refused.status).toBe(403);
    as(admin);
    const ok = await corrections.POST(post({ entity: "Client", id: "c-prop", field: "city", newValue: "Hubballi", reason: "Typed the wrong city" }));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ field: "city", before: "Bengaluru", after: "Hubballi" });
    const notAllowed = await corrections.POST(post({ entity: "Client", id: "c-prop", field: "name", newValue: "X", reason: "Typed the wrong name" }));
    expect(notAllowed.status).toBe(400);

    const h = await history.GET(get("http://x/api/firm-os/corrections/history?entity=Client&id=c-prop"));
    expect(h.status).toBe(200);
    const view = await json(h);
    expect((view.entries as unknown[]).length).toBe(1);
    expect((await history.GET(get("http://x/api/firm-os/corrections/history?entity=Client"))).status).toBe(400);
    as(null);
    expect((await history.GET(get("http://x/api/firm-os/corrections/history?entity=Client&id=c-prop"))).status).toBe(401);
  });
});

// LMS /clients DPDP gaps (ADR-006 class A):
//  - /clients/[id] shows PAN, GSTIN, phone and email masked to everyone; management (admins and
//    partners, who edit the client) get a "Show" per value, and each Show writes an AuditEvent;
//  - the /clients search matches a PAN, GSTIN, phone or email only exactly, by POST, never in the
//    page address; name and client-code search work as before.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml } from "./harness";

const CLIENT = vi.hoisted(() => ({
  id: "c-kumar", name: "Kumar Traders", active: true, entityType: "PROPRIETORSHIP", pan: "ABCPK1234F", gstin: "29ABCPK1234F1Z5", cin: null, industry: null, city: "Hubballi",
  contactName: "Kiran Kumar", contactPhone: "9876543210", contactEmail: "kiran@kumartraders.test", referralSource: null, turnover: 1_500_000, turnoverBand: "UNDER_40L",
  growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-04-01T00:00:00+05:30"), primaryHandlerId: "u1",
  primaryHandler: { name: "Priya", email: "priya@indefine.test" }, graphFolderId: null, folderName: "Kumar Traders", folderStatus: "READY", documents: [], jobs: [],
}));
const audits = vi.hoisted(() => [] as Record<string, unknown>[]);
const lookups = vi.hoisted(() => [] as unknown[][]);

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, prismaCalls: calls } = await import("./harness");
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string | symbol) => {
          if (key === "client") {
            return {
              findUnique: async (args: { where: { id: string } }) => (calls.push({ model: "client", method: "findUnique", args }), args.where.id === CLIENT.id ? CLIENT : null),
              findMany: async (args: unknown) => (calls.push({ model: "client", method: "findMany", args }), []),
            };
          }
          if (key === "auditEvent") return { create: async (args: { data: Record<string, unknown> }) => (audits.push(args.data), { id: `ae-${audits.length}` }) };
          return (prismaMock as Record<string | symbol, unknown>)[key];
        },
      },
    ),
  };
});
vi.mock("@/lib/search/identifiers", () => ({
  findByIdentifier: async (...args: unknown[]) => {
    lookups.push(args);
    const q = String(args[1]);
    if (q === "ABCPK1234F") return { ok: true, kind: "pan", masked: "XXXXXX234F", identifierHash: "h", searchedTypes: ["client"], hits: [{ type: "client", id: "c-kumar", label: "Kumar Traders", context: "Matched PAN XXXXXX234F", href: "/clients/c-kumar", rank: 0, at: "" }] };
    if (q === "ABCPK12") return { ok: false, reason: "partial", message: "Search by PAN needs the full 10-character PAN." };
    return { ok: true, kind: "email", masked: "n***@x.test", identifierHash: "h", searchedTypes: ["client"], hits: [] };
  },
}));

const { auth } = await import("@/lib/auth");
const { default: ClientPage } = await import("@/app/clients/[id]/page");
const { default: ClientsList } = await import("@/app/clients/page");
const reveal = (await import("@/app/api/clients/[id]/reveal/route")).POST;
const lookup = (await import("@/app/api/clients/lookup/route")).POST;
const as = (o: Parameters<typeof activeSession>[0] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(o ? activeSession(o) : null);
const render = async () => (await renderHtml(await ClientPage({ params: Promise.resolve({ id: CLIENT.id }) }))).replace(/<!-- -->/g, "");
const facts = (html: string) => html.slice(html.indexOf("<dl"), html.indexOf("</dl>"));
const post = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: CLIENT.id }) };

beforeEach(() => {
  audits.length = 0;
  lookups.length = 0;
  prismaCalls.length = 0;
});

describe("/clients/[id] identifiers", () => {
  it("staff see PAN (last 4), GSTIN (state + last 4), phone (last 4) and email (first letter + domain) masked, with no Show and no full value anywhere", async () => {
    as({ id: "u-staff" });
    const html = await render();
    const dl = facts(html);
    expect(dl).toContain("XXXXXX234F");
    expect(dl).toContain("29XXXXXXXXXF1Z5");
    expect(dl).toContain("XXXXXX3210");
    expect(dl).toContain("k***@kumartraders.test");
    expect(dl).toContain("Kiran Kumar");
    for (const full of [CLIENT.pan, CLIENT.gstin, CLIENT.contactPhone, CLIENT.contactEmail]) expect(html).not.toContain(full);
    expect(dl).not.toMatch(/>Show</);
    // Opening the page is a read audit: one "view" (ids and code only, no identifier), at most once an hour.
    expect(audits).toEqual([{ actorId: "u-staff", action: "view", entity: "Client", entityId: CLIENT.id, meta: { clientCode: null } }]);
    await render();
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/ABCPK|9876543210|kiran@/);
  });

  it("managers (not management) see masked values too; admins and partners see them masked with a Show per value", async () => {
    as({ id: "u-mgr", level: "MANAGER" });
    expect(facts(await render())).not.toMatch(/>Show</);
    for (const who of [{ id: "u-partner", level: "PARTNER" }, { id: "u-admin", role: "ADMIN" as const }]) {
      as(who);
      const dl = facts(await render());
      expect(dl).toContain("XXXXXX234F");
      expect(dl).not.toContain(CLIENT.pan);
      expect(dl.match(/>Show</g)).toHaveLength(4);
      expect(dl).toContain('aria-label="Show the full PAN (recorded)"');
    }
  });
});

describe("POST /api/clients/[id]/reveal", () => {
  it("gives management one full value and writes an AuditEvent (viewed PAN of client X) without the value", async () => {
    as({ id: "u-partner", level: "PARTNER" });
    const r = await reveal(post({ field: "pan" }), params);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.json()).toEqual({ field: "pan", value: CLIENT.pan });
    expect(audits).toEqual([{ actorId: "u-partner", action: "client-pii-view", entity: "Client", entityId: CLIENT.id, meta: { field: "pan", summary: `viewed PAN of client ${CLIENT.id}`, present: true } }]);
    expect(JSON.stringify(audits)).not.toContain(CLIENT.pan);
    await reveal(post({ field: "email" }), params);
    expect(audits.map((a) => (a.meta as { field: string }).field)).toEqual(["pan", "email"]);
  });

  it("refuses staff and managers (403, plain sentence, nothing recorded), signed-out visitors, unknown fields and clients", async () => {
    for (const who of [{ id: "u-staff" }, { id: "u-mgr", level: "MANAGER" }, { id: "u-gone", level: "PARTNER", active: false }]) {
      as(who);
      const r = await reveal(post({ field: "pan" }), params);
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe("Only admins and partners can see a client's full PAN, GSTIN, phone or email. Use the masked value, or ask one of them.");
    }
    as(null);
    expect((await reveal(post({ field: "pan" }), params)).status).toBe(401);
    as({ id: "u-partner", level: "PARTNER" });
    expect((await reveal(post({ field: "aadhaar" }), params)).status).toBe(400);
    expect((await reveal(post({ field: "pan" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect(audits).toEqual([]);
  });
});

describe("/clients search", () => {
  it("a full or partial PAN, GSTIN, phone or email in the address is removed (other filters kept) with a plain hint, and never queried", async () => {
    as({ id: "u-staff" });
    for (const q of ["ABCPK1234F", "abcpk12", "29ABCPK1234F1Z5", "98765 43210", "kiran@kumartraders.test", "98765"]) {
      prismaCalls.length = 0;
      const target = await redirectTarget(() => ClientsList({ searchParams: Promise.resolve({ q, fy: "2026-27", band: "UNDER_40L" }) }));
      expect(target, q).toBe("/clients?fy=2026-27&band=UNDER_40L&hint=identifier");
      expect(target).not.toContain(q.slice(0, 4));
      expect(prismaCalls.filter((c) => c.model === "client")).toEqual([]);
    }
    const html = await renderHtml(await ClientsList({ searchParams: Promise.resolve({ hint: "identifier" }) }));
    expect(html).toContain("Searches by PAN, GSTIN, phone or email are not kept in the page address");
  });

  it("name and client-code search are unchanged and never touch the PAN column", async () => {
    as({ id: "u-staff" });
    await ClientsList({ searchParams: Promise.resolve({ q: "Kumar" }) });
    const where = (prismaCalls.find((c) => c.model === "client" && c.method === "findMany")!.args as { where: unknown }).where;
    expect(where).toEqual({ OR: [{ name: { contains: "Kumar", mode: "insensitive" } }, { firmClient: { clientCode: { contains: "KUMAR" } } }] });
    expect(JSON.stringify(where)).not.toMatch(/"pan"|"gstin"|contactPhone|contactEmail/);
  });

  it("POST /api/clients/lookup: exact identifiers only, through the audited lookup; parts refused with a sentence; names refused", async () => {
    as({ id: "u-staff" });
    const ok = await lookup(post({ q: "ABCPK1234F" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(await ok.json()).toEqual({ matched: "PAN XXXXXX234F", hits: [{ id: "c-kumar", label: "Kumar Traders", context: "Matched PAN XXXXXX234F", href: "/clients/c-kumar" }] });
    expect(lookups[0]).toEqual([expect.objectContaining({ id: "u-staff" }), "ABCPK1234F", { purpose: "clients-search", types: ["client"] }]);
    const part = await lookup(post({ q: "ABCPK12" }));
    expect(part.status).toBe(400);
    expect((await part.json()).error).toBe("Search by PAN needs the full 10-character PAN. Part of a PAN, GSTIN, phone number or email is not searched.");
    const name = await lookup(post({ q: "Kumar Traders" }));
    expect(name.status).toBe(400);
    expect(lookups).toHaveLength(2); // the name was never sent to the identifier lookup
    as(null);
    expect((await lookup(post({ q: "ABCPK1234F" }))).status).toBe(401);
    as({ id: "u-gone", active: false });
    expect((await lookup(post({ q: "ABCPK1234F" }))).status).toBe(403);
  });
});

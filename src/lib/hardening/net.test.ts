// Security audit #23, #24, #33 (SSRF hygiene). Ported from the audit PoC (.audit-sec/web/ssrf.test.ts):
//   - sslExpiry() opened a TLS socket to any staff-typed host, loopback / RFC 1918 / metadata included;
//   - statutory docText() fetched any URL scraped from portal HTML (169.254.169.254 returned its body);
//   - a Graph nextLink was followed to any host with the bearer token;
//   - evidence links were rendered whatever their scheme.
// global fetch is replaced with a recorder: no real network.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRefusedError, httpsLink, isGraphUrl, isPublicAddress, resolvePublicHost, validateHostname, type Lookup } from "./net";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/office-tools/pdf", () => ({ extractPdfText: async () => "" }));

const calls: { url: string; init?: RequestInit }[] = [];
let responder: (url: string, init?: RequestInit) => Response = () => new Response("<html><body>internal page body</body></html>", { headers: { "content-type": "text/html" } });
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls.length = 0;
  responder = () => new Response("<html><body>internal page body</body></html>", { headers: { "content-type": "text/html" } });
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = typeof u === "string" ? u : u instanceof URL ? u.toString() : u.url;
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const lookupOf = (...addresses: string[]): Lookup => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("address and host rules", () => {
  it("only globally routable unicast addresses are public", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.100.100.200", "192.0.0.192", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "20.190.160.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });

  it("host names: plain DNS names only", () => {
    expect(validateHostname(" WWW.Example.IN. ")).toBe("www.example.in");
    for (const bad of ["127.0.0.1", "[::1]", "localhost", "intranet.local", "printer.internal", "example", "a b.com", "-x.com", "x.com:8443", "x.com/path", "user@x.com", "1.2.3.4.5", ""]) {
      expect(() => validateHostname(bad), bad).toThrow(HostRefusedError);
    }
  });

  it("resolvePublicHost refuses when ANY resolved address is private, and returns the address to pin", async () => {
    expect(await resolvePublicHost("www.example.in", lookupOf("93.184.216.34"))).toEqual({ host: "www.example.in", address: "93.184.216.34", family: 4 });
    await expect(resolvePublicHost("rebind.example.in", lookupOf("93.184.216.34", "169.254.169.254"))).rejects.toThrow(/private or reserved address/);
    await expect(resolvePublicHost("nx.example.in", async () => { throw Object.assign(new Error("nx"), { code: "ENOTFOUND" }); })).rejects.toThrow(/did not resolve \(ENOTFOUND\)/);
  });

  it("links shown to people are https only; Graph links are graph.microsoft.com only", () => {
    expect(httpsLink("https://contoso.sharepoint.com/sites/CL-ACME/x.xlsx")).toBe("https://contoso.sharepoint.com/sites/CL-ACME/x.xlsx");
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>", "http://example.in", "//evil.example/x", "/agents/x", "https://u:p@evil.example", "", null, 42]) expect(httpsLink(bad), String(bad)).toBeNull();
    expect(isGraphUrl("https://graph.microsoft.com/v1.0/users?$skiptoken=x")).toBe(true);
    for (const bad of ["https://evil.example/steal?x=1", "http://graph.microsoft.com/v1.0/users", "https://graph.microsoft.com.evil.example/x", "https://graph.microsoft.com@evil.example/", "https://x@graph.microsoft.com/v1.0"]) expect(isGraphUrl(bad), bad).toBe(false);
  });
});

describe("client-ops sslExpiry (PoC #23)", () => {
  /** A fake tls.connect that records its options and presents a certificate. */
  function fakeConnect() {
    const seen: Record<string, unknown>[] = [];
    const connect = ((opts: Record<string, unknown>, onSecure: () => void) => {
      seen.push(opts);
      const socket = Object.assign(new EventEmitter(), { destroy: () => {}, getPeerCertificate: () => ({ valid_to: "Jan 31 00:00:00 2027 GMT", subject: { CN: "www.example.in" } }) });
      setImmediate(onSecure);
      return socket;
    }) as never;
    return { connect, seen };
  }

  it("refuses loopback, private, metadata and IP-literal hosts without opening a socket", async () => {
    const { sslExpiry } = await import("@/lib/client-ops/lookup");
    const { connect, seen } = fakeConnect();
    expect(await sslExpiry("127.0.0.1", { connect })).toEqual({ error: "Enter a host name, not an IP address" });
    expect(await sslExpiry("169.254.169.254", { connect })).toMatchObject({ error: expect.stringMatching(/not an IP address/) });
    expect(await sslExpiry("localhost", { connect })).toMatchObject({ error: expect.stringMatching(/internal name/) });
    expect(await sslExpiry("db.example.in", { connect, lookup: lookupOf("10.0.0.5") })).toEqual({ error: "db.example.in resolves to a private or reserved address, so it is not checked" });
    expect(await sslExpiry("meta.example.in", { connect, lookup: lookupOf("169.254.169.254") })).toMatchObject({ error: expect.stringMatching(/private or reserved/) });
    expect(seen).toEqual([]);
  });

  it("a public host is probed at the resolved address with SNI = the name", async () => {
    const { sslExpiry } = await import("@/lib/client-ops/lookup");
    const { connect, seen } = fakeConnect();
    const r = await sslExpiry("www.example.in", { connect, lookup: lookupOf("93.184.216.34") });
    expect(r).toEqual({ date: new Date("Jan 31 00:00:00 2027 GMT"), note: "www.example.in" });
    expect(seen).toEqual([expect.objectContaining({ host: "93.184.216.34", servername: "www.example.in", port: 443 })]);
  });

  it("rdapExpiry stays pinned to rdap.org (unchanged)", async () => {
    const { rdapExpiry } = await import("@/lib/client-ops/lookup");
    responder = () => new Response(JSON.stringify({ events: [] }), { headers: { "content-type": "application/json" } });
    await rdapExpiry("169.254.169.254/latest/meta-data?x=");
    expect(new URL(calls[0].url).host).toBe("rdap.org");
  });
});

describe("statutory docText / lastModified (PoC #24)", () => {
  it("does not fetch a link off the statutory sites list — the metadata URL from the PoC included", async () => {
    const { docText, lastModified } = await import("@/lib/statutory/cloud");
    const text = await docText("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
    expect(calls).toEqual([]);
    expect(text).toBe("[unreadable: not fetched: 169.254.169.254 is not one of the statutory notification sites]");
    expect(text).not.toContain("internal page body");
    for (const bad of ["http://localhost:3000/api/x", "https://evil.example/x.pdf", "https://www.labour.gov.in:8443/x", "file:///etc/passwd", "https://user:pw@www.labour.gov.in/x"]) {
      expect((await docText(bad)).startsWith("[unreadable: not fetched"), bad).toBe(true);
    }
    expect(await lastModified("http://10.0.0.1/files/2026-10/x.pdf")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("fetches a listed public notification site (GET, manual redirects), and refuses a redirect to an internal address", async () => {
    const { docText, isStatutoryDocUrl } = await import("@/lib/statutory/cloud");
    responder = () => new Response("<html><main>Notification text of the Ministry</main></html>", { headers: { "content-type": "text/html" } });
    expect(await docText("https://www.labour.gov.in/whats-new/notice-1")).toBe("Notification text of the Ministry");
    expect(calls[0].init).toMatchObject({ redirect: "manual" });
    expect(calls[0].init?.method ?? "GET").toBe("GET");

    calls.length = 0;
    responder = (url) => (url.includes("labour") ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }) : new Response("SECRET"));
    const bounced = await docText("https://www.labour.gov.in/redirecting");
    expect(bounced).toMatch(/^\[unreadable: not fetched: 169\.254\.169\.254/);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["www.labour.gov.in"]);

    expect(isStatutoryDocUrl("https://resource.cdn.icai.org/x.pdf")).toBe(true);
    expect(isStatutoryDocUrl("https://icai.org.evil.example/x.pdf")).toBe(false);
    expect(isStatutoryDocUrl("https://evil-icai.org/x.pdf")).toBe(false);
  });
});

describe("Graph pagination in src/lib/graph.ts (PoC #33)", () => {
  it("listOrgUsers stops at a nextLink off graph.microsoft.com and never sends the bearer there", async () => {
    const { listOrgUsers } = await import("@/lib/graph");
    responder = (url) =>
      url.startsWith("https://graph.microsoft.com/")
        ? new Response(JSON.stringify({ value: [{ id: "1", accountEnabled: true, assignedLicenses: [{}], userType: "Member" }], "@odata.nextLink": "https://evil.example/steal?x=1" }))
        : new Response(JSON.stringify({ value: [] }));
    await expect(listOrgUsers("SECRET-GRAPH-TOKEN")).rejects.toThrow(/next-page link off graph\.microsoft\.com/);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["graph.microsoft.com"]);
  });

  it("follows a nextLink on graph.microsoft.com as before", async () => {
    const { listOrgUsers } = await import("@/lib/graph");
    let page = 0;
    responder = () => {
      page++;
      const u = { id: String(page), accountEnabled: true, assignedLicenses: [{}], userType: "Member" };
      return new Response(JSON.stringify(page === 1 ? { value: [u], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=abc" } : { value: [u] }));
    };
    expect((await listOrgUsers("t")).map((u) => u.id)).toEqual(["1", "2"]);
  });
});

describe("evidence links on the review screen (src/lib/agents/views.ts)", () => {
  it("loadRunReview drops a non-https evidence link (javascript:, http:) and keeps an https one", async () => {
    const { echoWorld, rows, user, NOW } = await import("../../../tests/fakes/agent-world");
    const { startAgentRun } = await import("@/lib/agents/service");
    const { loadRunReview } = await import("@/lib/agents/views");
    const w = echoWorld();
    expect(await startAgentRun(user("priya"), "echo", "job-1", w.deps)).toMatchObject({ ok: true });
    const results = rows(w.db, "checklistResult");
    results[0].evidence = { quote: "q", location: "register.csv row 2", link: "javascript:alert(document.cookie)" };
    results[1].evidence = { quote: "q", location: "register.csv row 3", link: "https://contoso.sharepoint.com/sites/CL-ACME01/x.xlsx" };
    const review = await loadRunReview(w.db as never, user("priya"), "run-1", NOW);
    const byId = new Map(review!.checklist.map((c) => [c.id, c.link]));
    expect(byId.get(results[0].id as string)).toBeNull();
    expect(byId.get(results[1].id as string)).toBe("https://contoso.sharepoint.com/sites/CL-ACME01/x.xlsx");
  }, 60_000);
});

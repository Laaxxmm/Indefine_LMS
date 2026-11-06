// Security re-audit NEW-3: the Firm OS Graph client sends a credential only where it belongs.
// The app-only Graph bearer goes only to https://graph.microsoft.com (an @odata.nextLink to any other
// host is refused, not followed); a SharePoint REST token only to the *.sharepoint.com host it was
// minted for; upload-session bytes only to graph.microsoft.com or a *.sharepoint.com host.
import { describe, expect, it } from "vitest";
import { createSharePointClient, isUploadSessionUrl, tokenMayGoTo } from "./graph-client";
import { UnsafeUrlError } from "./errors";

type Call = { url: string; method: string; auth: string | null };

/** A transport answering from a script by URL prefix; records every request and its Authorization header. */
function scripted(routes: [string, () => Response][]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: u, method: init?.method ?? "GET", auth: headers.Authorization ?? null });
    const hit = routes.find(([p]) => u.startsWith(p));
    return hit ? hit[1]() : new Response("{}", { status: 404 });
  };
  const client = createSharePointClient({ fetch, graphToken: async () => "GRAPH-SECRET", sharePointToken: async (h) => `SP-SECRET:${h}`, sleep: async () => {} });
  return { client, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const G = "https://graph.microsoft.com/v1.0";

describe("Graph bearer only to graph.microsoft.com", () => {
  it("an @odata.nextLink to another host is refused before anything is sent there (PoC: hop to attacker.example)", async () => {
    const { client, calls } = scripted([
      [`${G}/drives/d1/root:/F:/children`, () => json({ value: [{ id: "1", name: "a.xlsx" }], "@odata.nextLink": "https://attacker.example/steal?page=2" })],
      ["https://attacker.example", () => json({ value: [] })],
    ]);
    await expect(client.listChildren("d1", "F")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["graph.microsoft.com"]);
    expect(calls.some((c) => c.url.includes("attacker"))).toBe(false);
  });

  it("look-alike hosts, http, user info and other Microsoft hosts never get the Graph token", async () => {
    for (const next of ["http://graph.microsoft.com/v1.0/x", "https://graph.microsoft.com.attacker.example/x", "https://user:pw@graph.microsoft.com/x", "https://login.microsoftonline.com/x", "https://srcaassociate.sharepoint.com/x", "not a url"]) {
      const { client, calls } = scripted([[`${G}/drives/d1/root:/F:/children`, () => json({ value: [], "@odata.nextLink": next })]]);
      await expect(client.listChildren("d1", "F"), next).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(calls.filter((c) => c.auth === "Bearer GRAPH-SECRET").every((c) => new URL(c.url).host === "graph.microsoft.com")).toBe(true);
      expect(calls).toHaveLength(1);
    }
  });

  it("a nextLink on graph.microsoft.com is followed as before", async () => {
    const { client, calls } = scripted([
      [`${G}/drives/d1/root:/F:/children?`, () => json({ value: [{ id: "1", name: "a" }], "@odata.nextLink": `${G}/drives/d1/items/page2` })],
      [`${G}/drives/d1/items/page2`, () => json({ value: [{ id: "2", name: "b" }] })],
    ]);
    expect((await client.listChildren("d1", "F")).map((i) => i.name)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });
});

describe("upload sessions and SharePoint REST", () => {
  it("an upload session URL off Microsoft's hosts gets no bytes", async () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    const { client, calls } = scripted([[`${G}/drives/d1/root:/F/big.bin:/createUploadSession`, () => json({ uploadUrl: "https://attacker.example/upload/1" })]]);
    await expect(client.uploadFile("d1", "F/big.bin", big, { conflict: "fail" })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls.map((c) => c.method)).toEqual(["POST"]); // the session was created; nothing was PUT anywhere
  });

  it("a SharePoint token goes only to the https *.sharepoint.com host it was minted for", async () => {
    const { client, calls } = scripted([["https://srcaassociate.sharepoint.com/sites/CL-A/_api/site", () => json({ Id: "s1", HubSiteId: "h", IsHubSite: false })]]);
    expect(await client.getSiteInfo("https://srcaassociate.sharepoint.com/sites/CL-A")).toMatchObject({ Id: "s1" });
    expect(calls[0].auth).toBe("Bearer SP-SECRET:srcaassociate.sharepoint.com");
    await expect(client.getSiteInfo("https://attacker.example/sites/CL-A")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(client.getSiteInfo("http://srcaassociate.sharepoint.com/sites/CL-A")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toHaveLength(1);
  });

  it("the rules themselves", () => {
    expect(tokenMayGoTo(`${G}/sites/x`, { kind: "graph" })).toBe(true);
    expect(tokenMayGoTo("https://srcaassociate.sharepoint.com/_api/x", { kind: "graph" })).toBe(false);
    expect(tokenMayGoTo("https://srcaassociate.sharepoint.com/_api/x", { kind: "sp", host: "srcaassociate.sharepoint.com" })).toBe(true);
    expect(tokenMayGoTo("https://other.sharepoint.com/_api/x", { kind: "sp", host: "srcaassociate.sharepoint.com" })).toBe(false);
    expect(tokenMayGoTo("https://evil.example/_api/x", { kind: "sp", host: "evil.example" })).toBe(false);
    expect(isUploadSessionUrl("https://srcaassociate.sharepoint.com/_api/v2.0/drives/d/items/i/uploadSession?guid=1")).toBe(true);
    expect(isUploadSessionUrl(`${G}/upload/1`)).toBe(true);
    expect(isUploadSessionUrl("https://sharepoint.com.attacker.example/u")).toBe(false);
    expect(isUploadSessionUrl("http://srcaassociate.sharepoint.com/u")).toBe(false);
  });

  it("the refusal names the host only, never the URL (an upload URL carries its own credential)", () => {
    const e = new UnsafeUrlError("attacker.example", "file contents");
    expect(e.message).toBe("Refused to send file contents to attacker.example: it is not a Microsoft Graph or SharePoint address for this tenant.");
  });
});

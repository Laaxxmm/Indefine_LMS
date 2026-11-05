// Fewer Graph calls without weaker checks: item reads use $select; folder listings go out in JSON
// batches (GET-only, throttled sub-requests retried after Retry-After); the deliverable store keeps a
// client's drive id and one folder listing per run; and a file this process uploaded or hashed is
// verified from its metadata (cTag + quickXorHash + size) — any edit in SharePoint is downloaded
// and hashed as before.
import { describe, expect, it } from "vitest";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";
import { graphDeliverableVerifier, sha256Hex } from "@/lib/close-loop/verifier";
import { createClFolders } from "./clfolders";
import { readSharePointConfig } from "./config";
import { createContentRegistry, factsFromBytes, liveFingerprint } from "./content-registry";
import { DRIVE_ID_TTL_MS, LISTING_TTL_MS, createDeliverableStore } from "./deliverable-store";
import { BATCH_MAX, ITEM_SELECT, createSharePointClient } from "./graph-client";
import { quickXorHash } from "./quick-xor-hash";

const W = "FY2026-27/GST/2026-10/Working";
const F = "FY2026-27/GST/2026-10/Final";

function setup() {
  const fake = new FakeSharePoint();
  const site = fake.addSite("/sites/CL-ACME01");
  const drive = fake.addLibrary(site, "Compliance");
  const sleeps: number[] = [];
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "t", sleep: async (ms) => void sleeps.push(ms), now: () => Date.parse("2026-11-05T10:00:00Z") });
  let t = 0;
  const registry = createContentRegistry();
  const store = createDeliverableStore(client, { registry, now: () => t });
  const tick = (ms: number) => (t += ms);
  const downloads = () => fake.calls.filter((c) => c.method === "GET" && c.url.endsWith(":/content")).length;
  return { fake, drive, client, store, registry, tick, sleeps, downloads };
}

describe("graph-client", () => {
  it("item reads ask only for the fields the code uses", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, `${F}/a.xlsx`, "bytes");
    const item = await client.getItemByPath(drive.id, `${F}/a.xlsx`);
    expect(item).toMatchObject({ name: "a.xlsx", size: 5, cTag: expect.stringMatching(/^"c:/), file: { hashes: { quickXorHash: quickXorHash(Buffer.from("bytes")) } } });
    expect(fake.calls.at(-1)!.url).toContain(`?$select=${ITEM_SELECT}`);
    await client.listChildren(drive.id, F);
    expect(fake.calls.at(-1)!.url).toContain(`?$select=${ITEM_SELECT}&$top=200`);
  });

  it("listChildrenMany: ≤ 20 GETs per batch request, null for a missing folder, reads only", async () => {
    const { fake, drive, client } = setup();
    const paths = Array.from({ length: 25 }, (_, i) => `F${i}`);
    for (const p of paths.slice(0, 24)) fake.addFile(drive, `${p}/x.txt`, p);
    const lists = await client.listChildrenMany(drive.id, paths);
    expect(lists.slice(0, 24).map((l) => l?.map((i) => i.name))).toEqual(paths.slice(0, 24).map(() => ["x.txt"]));
    expect(lists[24]).toBeNull();
    expect(fake.calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual(["POST https://graph.microsoft.com/v1.0/$batch", "POST https://graph.microsoft.com/v1.0/$batch"]);
    expect(fake.batchedCalls).toHaveLength(25);
    expect(fake.batchedCalls.every((c) => c.method === "GET")).toBe(true);
    expect(fake.mutations).toEqual([]);
    expect(fake.violations).toEqual([]);
    expect(BATCH_MAX).toBe(20);
  });

  it("retries throttled sub-requests after their Retry-After; a non-retryable status throws", async () => {
    const { fake, drive, client, sleeps } = setup();
    fake.addFolder(drive, "A");
    fake.addFolder(drive, "B");
    fake.queuedSub.push({ status: 429, headers: { "Retry-After": "3" } });
    const lists = await client.listChildrenMany(drive.id, ["A", "B"]);
    expect(lists).toEqual([[], []]);
    expect(sleeps).toEqual([3000]);
    expect(fake.batchedCalls.map((c) => c.url.split("?")[0].split("/root:/")[1])).toEqual(["A:/children", "B:/children", "A:/children"]);
    fake.queuedSub.push({ status: 403 });
    await expect(client.listChildrenMany(drive.id, ["A"])).rejects.toMatchObject({ name: "GraphError", status: 403 });
  });
});

describe("deliverable store", () => {
  it("looks a client's Compliance drive up once (until the TTL), never caching a miss", async () => {
    const { fake, store, tick } = setup();
    const id = await store.complianceDrive("ACME01");
    const n = fake.calls.length;
    expect(await store.complianceDrive("ACME01")).toBe(id);
    expect(fake.calls.length).toBe(n);
    tick(DRIVE_ID_TTL_MS + 1);
    await store.complianceDrive("ACME01");
    expect(fake.calls.length).toBe(n + 2);
    await expect(store.complianceDrive("NOPE01")).rejects.toThrow(/does not exist yet/);
    await expect(store.complianceDrive("NOPE01")).rejects.toThrow(/does not exist yet/);
  });

  it("numbers several uploads into one folder from a single listing; a missing folder costs one GET", async () => {
    const { fake, drive, store, tick } = setup();
    const before = fake.calls.length;
    const a = await store.putNew(drive.id, W, "ACME_Pack_v1.xlsx", Buffer.from("a"));
    const b = await store.putNew(drive.id, W, "ACME_Pack_v1.xlsx", Buffer.from("b"));
    const c = await store.putNew(drive.id, W, "ACME_Sheet_v1.xlsx", Buffer.from("c"));
    expect([a.fileName, b.fileName, c.fileName]).toEqual(["ACME_Pack_v1.xlsx", "ACME_Pack_v2.xlsx", "ACME_Sheet_v1.xlsx"]);
    const kinds = fake.calls.slice(before).map((x) => (x.method === "PUT" ? "PUT" : x.url.includes(":/children") ? "LIST" : "OTHER"));
    expect(kinds).toEqual(["LIST", "PUT", "PUT", "PUT"]);
    // A file another person put there after the listing: create-only upload → 409 → next version.
    fake.addFile(drive, `${W}/ACME_Pack_v3.xlsx`, "someone else");
    expect((await store.putNew(drive.id, W, "ACME_Pack_v1.xlsx", Buffer.from("d"))).fileName).toBe("ACME_Pack_v4.xlsx");
    tick(LISTING_TTL_MS + 1);
    const n = fake.calls.length;
    await store.putNew(drive.id, W, "ACME_Pack_v1.xlsx", Buffer.from("e"));
    expect(fake.calls.slice(n).filter((x) => x.url.includes(":/children"))).toHaveLength(1);
  });

  it("verifies an uploaded file from its metadata; an edit in SharePoint is downloaded and caught", async () => {
    const { fake, drive, store, downloads } = setup();
    const s = await store.putNew(drive.id, F, "ACME_Pack_v1.xlsx", Buffer.from("approved pack"));
    expect(await store.verify(drive.id, F, s.fileName, s.sha256)).toBe(true);
    expect(await store.verify(drive.id, F, s.fileName, "0".repeat(64))).toBe(false);
    expect(downloads()).toBe(0);
    fake.replaceFile(drive, `${F}/${s.fileName}`, "approved pack, edited");
    expect(await store.verify(drive.id, F, s.fileName, s.sha256)).toBe(false);
    expect(downloads()).toBe(1);
  });
});

describe("close-gate verifier", () => {
  it("a file uploaded by this process: SHA-256 from the registry, no download", async () => {
    const { fake, drive, client, store, registry, downloads } = setup();
    const s = await store.putNew(drive.id, F, "ACME_Pack_v1.xlsx", Buffer.from("approved pack"));
    const v = graphDeliverableVerifier(() => client, { registry });
    const live = await v.getItem({ clientCode: "ACME01", driveId: drive.id, driveItemId: s.item.id, path: `${F}/${s.fileName}` });
    expect(live).toMatchObject({ exists: true, driveItemId: s.item.id, sha256: s.sha256 });
    expect(downloads()).toBe(0);
    void fake;
  });

  it("after a restart: the first check downloads and learns, the next is metadata only; an edit is never trusted", async () => {
    const { fake, drive, client, downloads } = setup();
    fake.addFile(drive, `${F}/A_v1.xlsx`, "final bytes");
    const registry = createContentRegistry(); // a fresh process
    const ref = { clientCode: "ACME01", driveId: drive.id, driveItemId: drive.items.get(`${F}/A_v1.xlsx`)!.id, path: `${F}/A_v1.xlsx` };
    const v1 = graphDeliverableVerifier(() => client, { registry });
    expect((await v1.getItem(ref)).sha256).toBeNull();
    expect(sha256Hex((await v1.download(ref))!)).toBe(sha256Hex(Buffer.from("final bytes")));
    const v2 = graphDeliverableVerifier(() => client, { registry }); // the next cron run builds new deps
    expect((await v2.getItem(ref)).sha256).toBe(sha256Hex(Buffer.from("final bytes")));
    expect(downloads()).toBe(1);
    fake.replaceFile(drive, ref.path, "final bytes, edited in SharePoint");
    expect((await v2.getItem(ref)).sha256).toBeNull(); // cTag changed: the gate downloads and compares
  });

  it("never trusts quickXorHash alone: no cTag, a size or quickXorHash that differs, or bytes that are not the described content", () => {
    const bytes = Buffer.from("approved pack");
    const qx = quickXorHash(bytes);
    const sha = sha256Hex(bytes);
    const item = { id: "i1", size: bytes.length, cTag: '"c:{i1},1"', file: { hashes: { quickXorHash: qx } } };
    expect(liveFingerprint({ ...item, cTag: undefined })).toBeNull();
    expect(factsFromBytes({ ...item, cTag: undefined }, bytes, sha)).toBeNull();
    expect(factsFromBytes({ ...item, file: { hashes: { quickXorHash: quickXorHash(Buffer.from("other")) } } }, bytes, sha)).toBeNull(); // SharePoint holds other bytes
    expect(factsFromBytes({ ...item, size: 1 }, bytes, sha)).toBeNull();
    const r = createContentRegistry(2);
    r.remember("d", "i1", factsFromBytes(item, bytes, sha)!);
    expect(r.knownSha256("d", item)).toBe(sha);
    expect(r.knownSha256("d", { ...item, cTag: '"c:{i1},2"' })).toBeNull();
    expect(r.knownSha256("d", { ...item, size: 99 })).toBeNull();
    expect(r.knownSha256("d", { ...item, file: { hashes: { quickXorHash: "x" } } })).toBeNull();
    expect(r.knownSha256("other-drive", item)).toBeNull();
    r.remember("d", "i2", { sha256: "A", quickXorHash: "q", size: 1, cTag: "c" });
    r.remember("d", "i3", { sha256: "B", quickXorHash: "q", size: 1, cTag: "c" });
    expect(r.size).toBeLessThanOrEqual(2); // bounded
    expect(r.knownSha256("d", item)).toBeNull(); // the oldest generation was dropped
  });
});

describe("ensureFyTree reads an existing tree in a few batched requests", () => {
  it("second run: no writes, 7 HTTP requests (site, drive, root, FY, 2 batches + 1) instead of ~32", async () => {
    const fake = new FakeSharePoint();
    fake.addHub();
    const config = readSharePointConfig({ SP_PNP_CLIENT_ID: "x", SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_PEM: "c", SP_SITE_OWNER: "owner@x" });
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s", sleep: async () => {} });
    const site = fake.addSite("/sites/CL-ACME01");
    fake.addLibrary(site, "Compliance");
    const cl = createClFolders({ client, config, sleep: async () => {} });
    const first = await cl.ensureFyTree("ACME01", "2026-27");
    expect(first.created.length).toBeGreaterThan(100);
    const before = fake.calls.length;
    const mutations = fake.mutations.length;
    const second = await cl.ensureFyTree("ACME01", "2026-27");
    expect(second.created).toEqual([]);
    const calls = fake.calls.slice(before);
    expect(fake.mutations.length).toBe(mutations);
    expect(calls.length).toBeLessThanOrEqual(7);
    expect(calls.filter((c) => c.url.endsWith("/$batch")).length).toBeGreaterThanOrEqual(2);
    expect(fake.batchedCalls.every((c) => c.method === "GET")).toBe(true);
  });
});

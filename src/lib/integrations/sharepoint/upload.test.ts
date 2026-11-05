// File content on Path A: create-only uploads (simple and session), download, copy, and the
// hashes getItemByPath reports. Runs the real client against the in-memory fake.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createSharePointClient, SIMPLE_UPLOAD_MAX_BYTES, UPLOAD_CHUNK_BYTES, type ClientOptions } from "./graph-client";
import { ConflictError, GraphError } from "./errors";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function setup(over: Partial<ClientOptions> = {}) {
  const fake = new FakeSharePoint();
  const site = fake.addSite("/sites/CL-ACME");
  const drive = fake.addLibrary(site, "Compliance");
  fake.addFolder(drive, "FY2026-27/GST/2026-10/Working");
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "graph-token", sleep: async () => {}, ...over });
  return { fake, drive, client };
}

describe("uploadFile", () => {
  it("simple upload (≤ 4 MB) creates the file and returns its item", async () => {
    const { fake, drive, client } = setup();
    const bytes = Buffer.from("hello pack");
    const item = await client.uploadFile(drive.id, "FY2026-27/GST/2026-10/Working/a_v1.xlsx", bytes, { conflict: "fail" });
    expect(item.name).toBe("a_v1.xlsx");
    expect(item.size).toBe(bytes.length);
    expect(fake.fileContent(drive, "FY2026-27/GST/2026-10/Working/a_v1.xlsx")?.equals(bytes)).toBe(true);
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain(":/content?@microsoft.graph.conflictBehavior=fail");
    expect(fake.violations).toEqual([]);
  });

  it("never overwrites: an existing file → ConflictError and the bytes are unchanged", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, "FY2026-27/GST/2026-10/Working/a_v1.xlsx", "original");
    await expect(client.uploadFile(drive.id, "FY2026-27/GST/2026-10/Working/a_v1.xlsx", Buffer.from("new"), { conflict: "fail" })).rejects.toBeInstanceOf(ConflictError);
    expect(fake.fileContent(drive, "FY2026-27/GST/2026-10/Working/a_v1.xlsx")?.toString()).toBe("original");
    expect(fake.violations).toEqual([]);
  });

  it("refuses any conflict behaviour other than fail, and folder-like paths", async () => {
    const { drive, client } = setup();
    const opts = { conflict: "replace" } as unknown as { conflict: "fail" };
    await expect(client.uploadFile(drive.id, "x/a.xlsx", Buffer.from("x"), opts)).rejects.toThrow(/only supports conflict 'fail'/);
    await expect(client.uploadFile(drive.id, "x/", Buffer.from("x"), { conflict: "fail" })).rejects.toThrow(/needs a file path/);
    await expect(client.uploadFile(drive.id, "", Buffer.from("x"), { conflict: "fail" })).rejects.toThrow(/needs a file path/);
  });

  it("large files (> 4 MB) go through an upload session in 320 KiB-multiple chunks without a bearer token", async () => {
    const { fake, drive, client } = setup();
    const bytes = Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 1234, 7);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 2;
    const item = await client.uploadFile(drive.id, "FY2026-27/GST/2026-10/Working/big_v1.xlsx", bytes, { conflict: "fail" });
    expect(item.size).toBe(bytes.length);
    expect(sha(fake.fileContent(drive, "FY2026-27/GST/2026-10/Working/big_v1.xlsx")!)).toBe(sha(bytes));
    const puts = fake.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES));
    expect(UPLOAD_CHUNK_BYTES % (320 * 1024)).toBe(0);
    expect(fake.calls.some((c) => c.method === "POST" && c.url.endsWith(":/createUploadSession"))).toBe(true);
    expect(fake.sessionAuthLeaks).toEqual([]);
    expect(fake.violations).toEqual([]);
  });

  it("upload session on an existing file → ConflictError before any bytes move", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, "w/big.xlsx", "x");
    await expect(client.uploadFile(drive.id, "w/big.xlsx", Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 1), { conflict: "fail" })).rejects.toBeInstanceOf(ConflictError);
    expect(fake.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("a session chunk rejected by the server surfaces a GraphError without leaking the session URL", async () => {
    const { fake, drive, client } = setup({ maxRetries: 0 });
    const bytes = Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 10);
    const orig = fake.fetch;
    let n = 0;
    const err = await createSharePointClient({
      fetch: async (url, init) => (init.method === "PUT" && ++n === 1 ? new Response("{}", { status: 400 }) : orig(url, init)),
      graphToken: async () => "t",
      sleep: async () => {},
      maxRetries: 0,
    })
      .uploadFile(drive.id, "w/big.xlsx", bytes, { conflict: "fail" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).message).toContain("upload session for w/big.xlsx");
    expect((err as GraphError).message).not.toContain("_upload");
    void client;
  });

  it("a simple upload failure (not 409) is a GraphError; a session conflict at completion is a ConflictError", async () => {
    const { fake, drive, client } = setup({ maxRetries: 0 });
    fake.queued.push(() => new Response("nope", { status: 400 }));
    await expect(client.uploadFile(drive.id, "w/a.xlsx", Buffer.from("x"), { conflict: "fail" })).rejects.toBeInstanceOf(GraphError);
    fake.queued.push(() => new Response("{}", { status: 500 }));
    await expect(client.uploadFile(drive.id, "w/big.xlsx", Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 1), { conflict: "fail" })).rejects.toBeInstanceOf(GraphError);
    // Session completes after someone else created the same name.
    const bytes = Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 5);
    const raced = createSharePointClient({
      fetch: async (url, init) => {
        if (init.method === "PUT") return new Response(JSON.stringify({ error: "nameAlreadyExists" }), { status: 409 });
        return fake.fetch(url, init);
      },
      graphToken: async () => "t",
      sleep: async () => {},
    });
    await expect(raced.uploadFile(drive.id, "w/race.xlsx", bytes, { conflict: "fail" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("retries a throttled upload", async () => {
    const { fake, drive, client } = setup();
    fake.queued.push(() => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }));
    const item = await client.uploadFile(drive.id, "w/a.xlsx", Buffer.from("x"), { conflict: "fail" });
    expect(item.name).toBe("a.xlsx");
  });
});

describe("downloadFile / copyItem / getItemByPath", () => {
  it("downloads bytes, and null for a missing file", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, "w/a.txt", "abc");
    expect((await client.downloadFile(drive.id, "w/a.txt"))?.toString()).toBe("abc");
    expect(await client.downloadFile(drive.id, "w/missing.txt")).toBeNull();
    fake.queued.push(() => new Response("boom", { status: 403 }));
    await expect(client.downloadFile(drive.id, "w/a.txt")).rejects.toBeInstanceOf(GraphError);
  });

  it("copyItem copies bytes create-only and returns the copy's sha256", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, "Working/a_v1.xlsx", "pack-bytes");
    const out = await client.copyItem(drive.id, "Working/a_v1.xlsx", "Final/a_v1.xlsx", { conflict: "fail" });
    expect(out.sha256).toBe(sha(Buffer.from("pack-bytes")));
    expect(out.sizeBytes).toBe(10);
    expect(fake.fileContent(drive, "Final/a_v1.xlsx")?.toString()).toBe("pack-bytes");
    await expect(client.copyItem(drive.id, "Working/a_v1.xlsx", "Final/a_v1.xlsx", { conflict: "fail" })).rejects.toBeInstanceOf(ConflictError);
    await expect(client.copyItem(drive.id, "Working/none.xlsx", "Final/none.xlsx", { conflict: "fail" })).rejects.toThrow(/copy source not found/);
  });

  it("getItemByPath reports size and hashes for files (sha256Hash only where the drive gives it)", async () => {
    const { fake, drive, client } = setup();
    fake.addFile(drive, "w/a.txt", "abc");
    const item = await client.getItemByPath(drive.id, "w/a.txt");
    expect(item?.size).toBe(3);
    expect(item?.file?.hashes?.quickXorHash).toBeTruthy();
    expect(item?.file?.hashes?.sha256Hash).toBeUndefined();
    fake.reportSha256Hash = true;
    expect((await client.getItemByPath(drive.id, "w/a.txt"))?.file?.hashes?.sha256Hash).toBe(sha(Buffer.from("abc")).toUpperCase());
    const kids = await client.listChildren(drive.id, "w");
    expect(kids.map((k) => [k.name, k.size, !!k.file])).toEqual([["a.txt", 3, true]]);
  });
});

describe("fake keeps its no-destructive contract", () => {
  it("PUT without conflictBehavior=fail, or to an unknown session, is a 405 violation", async () => {
    const { fake, drive } = setup();
    const overwrite = await fake.fetch(`https://graph.microsoft.com/v1.0/drives/${drive.id}/root:/w/a.txt:/content`, { method: "PUT", body: Buffer.from("x") });
    expect(overwrite.status).toBe(405);
    const bogus = await fake.fetch(`https://${fake.host}/_upload/session-999`, { method: "PUT", body: Buffer.from("x") });
    expect(bogus.status).toBe(405);
    const patch = await fake.fetch(`https://graph.microsoft.com/v1.0/drives/${drive.id}/root:/w/a.txt`, { method: "PATCH" });
    expect(patch.status).toBe(405);
    expect(fake.violations).toHaveLength(3);
  });
});

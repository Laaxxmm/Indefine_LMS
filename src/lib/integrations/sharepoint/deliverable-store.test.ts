import { describe, expect, it } from "vitest";
import { createSharePointClient, type SharePointClient } from "./graph-client";
import { ConflictError, NotProvisionedError } from "./errors";
import { MAX_VERSION_ATTEMPTS, createDeliverableStore, nextFreeVersion, sha256Hex, versionOf, withVersion } from "./deliverable-store";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";

const W = "FY2026-27/GST/2026-10/Working";
const F = "FY2026-27/GST/2026-10/Final";

function setup() {
  const fake = new FakeSharePoint();
  const site = fake.addSite("/sites/CL-ACME");
  const drive = fake.addLibrary(site, "Compliance");
  fake.addFolder(drive, W);
  fake.addFolder(drive, F);
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "t", sleep: async () => {} });
  return { fake, drive, client, store: createDeliverableStore(client) };
}

describe("version suffix helpers", () => {
  it("reads and sets _v{n}", () => {
    expect(versionOf("ACME_Pack_2026-10_v3.xlsx")).toBe(3);
    expect(versionOf("ACME_Pack.xlsx")).toBeNull();
    expect(withVersion("ACME_Pack_2026-10_v1.xlsx", 2)).toBe("ACME_Pack_2026-10_v2.xlsx");
    expect(withVersion("ACME_Pack.xlsx", 2)).toBe("ACME_Pack_v2.xlsx");
    expect(withVersion("README", 4)).toBe("README_v4");
    expect(() => withVersion("a.xlsx", 0)).toThrow(/positive integer/);
  });
  it("finds the lowest free version from a starting point, case-insensitively", () => {
    expect(nextFreeVersion("a_v1.xlsx", [], 1)).toBe(1);
    expect(nextFreeVersion("a_v1.xlsx", ["A_V1.xlsx", "a_v2.xlsx"], 1)).toBe(3);
    expect(nextFreeVersion("a_v1.xlsx", ["a_v1.xlsx"], 2)).toBe(2);
    expect(nextFreeVersion("a_v1.xlsx", [], 0)).toBe(1);
  });
});

describe("DeliverableStore", () => {
  it("resolves the Compliance drive, or says what to provision", async () => {
    const { store, drive, fake } = setup();
    expect(await store.complianceDrive("ACME")).toBe(drive.id);
    await expect(store.complianceDrive("NOPE")).rejects.toBeInstanceOf(NotProvisionedError);
    fake.addSite("/sites/CL-BARE");
    await expect(store.complianceDrive("BARE")).rejects.toThrow(/The Compliance library on the client's SharePoint site/);
  });

  it("putNew keeps the requested version when free and bumps when taken (never overwrites)", async () => {
    const { store, drive, fake } = setup();
    const a = await store.putNew(drive.id, W, "ACME_Pack_2026-10_v1.xlsx", Buffer.from("one"));
    expect(a).toMatchObject({ fileName: "ACME_Pack_2026-10_v1.xlsx", version: 1, sizeBytes: 3, sha256: sha256Hex(Buffer.from("one")), folder: W });
    const b = await store.putNew(drive.id, W, "ACME_Pack_2026-10_v1.xlsx", Buffer.from("two"));
    expect(b.fileName).toBe("ACME_Pack_2026-10_v2.xlsx");
    expect(fake.fileContent(drive, `${W}/ACME_Pack_2026-10_v1.xlsx`)?.toString()).toBe("one");
    expect(fake.violations).toEqual([]);
  });

  it("putNew into a folder that does not exist yet starts at the file's own version", async () => {
    const { store, drive } = setup();
    const out = await store.putNew(drive.id, "FY2026-27/GST/2026-11/Working", "A_v2.xlsx", Buffer.from("x"));
    expect(out.fileName).toBe("A_v2.xlsx");
  });

  it("bumps again when another writer wins the race (409 after listing)", async () => {
    const { fake, drive } = setup();
    let first = true;
    const client = createSharePointClient({
      fetch: async (url, init) => {
        if (init.method === "PUT" && first) {
          first = false;
          fake.addFile(drive, `${F}/A_v1.xlsx`, "someone else");
        }
        return fake.fetch(url, init);
      },
      graphToken: async () => "t",
      sleep: async () => {},
    });
    const out = await createDeliverableStore(client).putNew(drive.id, F, "A_v1.xlsx", Buffer.from("mine"));
    expect(out.fileName).toBe("A_v2.xlsx");
    expect(fake.fileContent(drive, `${F}/A_v1.xlsx`)?.toString()).toBe("someone else");
  });

  it("gives up after MAX_VERSION_ATTEMPTS conflicts, and rethrows other errors", async () => {
    const { client, drive } = setup();
    const always409 = { ...client, uploadFile: async (_d: string, p: string) => { throw new ConflictError(p); } } as SharePointClient;
    await expect(createDeliverableStore(always409).putNew(drive.id, W, "A_v1.xlsx", Buffer.from("x"))).rejects.toThrow(new RegExp(`${MAX_VERSION_ATTEMPTS} attempts`));
    const broken = { ...client, uploadFile: async () => { throw new Error("network down"); } } as SharePointClient;
    await expect(createDeliverableStore(broken).putNew(drive.id, W, "A_v1.xlsx", Buffer.from("x"))).rejects.toThrow("network down");
  });

  it("copyVersioned copies Working → Final with a version suffix; a second approval gets _v2", async () => {
    const { store, drive, fake } = setup();
    fake.addFile(drive, `${W}/ACME_Pack_2026-10_v1.xlsx`, "approved-bytes");
    const first = await store.copyVersioned(drive.id, W, "ACME_Pack_2026-10_v1.xlsx", F);
    expect(first.fileName).toBe("ACME_Pack_2026-10_v1.xlsx");
    expect(first.sha256).toBe(sha256Hex(Buffer.from("approved-bytes")));
    const second = await store.copyVersioned(drive.id, W, "ACME_Pack_2026-10_v1.xlsx", F);
    expect(second.fileName).toBe("ACME_Pack_2026-10_v2.xlsx");
    expect(fake.filesIn(drive, F)).toEqual(["ACME_Pack_2026-10_v1.xlsx", "ACME_Pack_2026-10_v2.xlsx"]);
    await expect(store.copyVersioned(drive.id, W, "missing_v1.xlsx", F)).rejects.toBeInstanceOf(NotProvisionedError);
  });

  it("read and verify (download-and-hash, or the drive's sha256Hash when reported)", async () => {
    const { store, drive, fake } = setup();
    fake.addFile(drive, `${F}/A_v1.xlsx`, "bytes");
    const good = sha256Hex(Buffer.from("bytes"));
    expect((await store.read(drive.id, F, "A_v1.xlsx"))?.toString()).toBe("bytes");
    expect(await store.verify(drive.id, F, "A_v1.xlsx", good)).toBe(true);
    expect(await store.verify(drive.id, F, "A_v1.xlsx", "0".repeat(64))).toBe(false);
    expect(await store.verify(drive.id, F, "nope.xlsx", good)).toBe(false);
    fake.reportSha256Hash = true;
    const before = fake.calls.length;
    expect(await store.verify(drive.id, F, "A_v1.xlsx", good.toUpperCase())).toBe(true);
    expect(fake.calls.slice(before).some((c) => c.url.endsWith(":/content"))).toBe(false);
  });
});

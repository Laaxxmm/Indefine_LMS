// Graph-backed DeliverableVerifier: GET-only lookups through the Path A graph-client.
import { describe, expect, it, vi } from "vitest";
import { NotProvisionedError } from "@/lib/integrations/sharepoint/errors";
import { MISSING, graphDeliverableVerifier, sha256Hex, type VerifierGraph } from "./verifier";

const ref = { clientCode: "ACME01", driveId: null, driveItemId: "item-1", path: "FY2026-27/GST/2026-10/Final/a.xlsx" };

function graph(over: Partial<VerifierGraph> = {}) {
  const g = {
    getSiteByUrl: vi.fn(async () => ({ id: "site-1", webUrl: "https://x/sites/CL-ACME01" })),
    getDriveByName: vi.fn(async () => ({ id: "drive-1", name: "Compliance" })),
    getItemByPath: vi.fn(async () => ({ id: "item-1", name: "a.xlsx", size: 12, file: { hashes: { sha256Hash: "ABC" } } })),
    downloadFile: vi.fn(async () => Buffer.from("bytes")),
    ...over,
  };
  return g as typeof g & VerifierGraph;
}

describe("graphDeliverableVerifier", () => {
  it("looks the Compliance drive up once per client and reports id, size, path and Graph sha256", async () => {
    const g = graph();
    const v = graphDeliverableVerifier(() => g);
    expect(await v.getItem(ref)).toEqual({ exists: true, driveItemId: "item-1", sizeBytes: 12, path: ref.path, sha256: "ABC" });
    await v.getItem(ref);
    expect(g.getSiteByUrl).toHaveBeenCalledTimes(1);
    expect(g.getSiteByUrl).toHaveBeenCalledWith("https://srcaassociate.sharepoint.com/sites/CL-ACME01");
    expect(g.getDriveByName).toHaveBeenCalledWith("site-1", "Compliance");
    expect(g.getItemByPath).toHaveBeenCalledWith("drive-1", ref.path);
  });

  it("uses the recorded driveId without a site lookup, and downloads by path", async () => {
    const g = graph();
    const v = graphDeliverableVerifier(() => g, { host: "tenant.sharepoint.com" });
    const bytes = await v.download({ ...ref, driveId: "drive-9" });
    expect(sha256Hex(bytes!)).toBe(sha256Hex(Buffer.from("bytes")));
    expect(g.downloadFile).toHaveBeenCalledWith("drive-9", ref.path);
    expect(g.getSiteByUrl).not.toHaveBeenCalled();
  });

  it("a missing item, a folder, or no reported hash", async () => {
    expect(await graphDeliverableVerifier(() => graph({ getItemByPath: async () => null })).getItem(ref)).toEqual(MISSING);
    expect(await graphDeliverableVerifier(() => graph({ getItemByPath: async () => ({ id: "f", name: "x", folder: {} }) })).getItem(ref)).toEqual(MISSING);
    const noHash = await graphDeliverableVerifier(() => graph({ getItemByPath: async () => ({ id: "item-1", name: "a.xlsx" }) })).getItem(ref);
    expect(noHash).toMatchObject({ exists: true, sizeBytes: 0, sha256: null });
  });

  it("an unprovisioned site or library is an error (the gate turns it into a reason)", async () => {
    await expect(graphDeliverableVerifier(() => graph({ getSiteByUrl: async () => null })).getItem(ref)).rejects.toBeInstanceOf(NotProvisionedError);
    await expect(graphDeliverableVerifier(() => graph({ getDriveByName: async () => null })).getItem(ref)).rejects.toThrow(/Library Compliance/);
  });
});

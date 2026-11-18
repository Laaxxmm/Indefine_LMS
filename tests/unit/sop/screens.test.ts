// Screenshots under SOP steps: the picture header is read, not trusted; screens land only on
// steps that exist; an AI rewrite keeps them by step number and flags what changed; the Word file
// carries them; and each SOP's Word files go to its own OneDrive folder.
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { assembleSop } from "@/lib/sop/gemini";
import { renderSopDocx } from "@/lib/sop/render";
import { applyScreens, carryScreens, fitBox, imageSize, screenIds } from "@/lib/sop/screens";
import type { SopBrief, SopContent } from "@/lib/sop/types";

const graph = vi.hoisted(() => ({
  getAppOnlyToken: vi.fn(async () => "t"),
  getUserGraphToken: vi.fn(async () => null),
  ensureFolder: vi.fn(async (_d: string, parent: string, name: string) => `${parent}/${name}`),
  getDriveItem: vi.fn(),
  createFolderIn: vi.fn(async () => "new-folder"),
  moveDriveItem: vi.fn(async () => true),
  uploadFileToFolderId: vi.fn(async (): Promise<{ id: string; size: number; webUrl: string } | null> => ({ id: "file-1", size: 1, webUrl: "https://onedrive.test/file-1" })),
}));
vi.mock("@/lib/graph", () => graph);
const { saveSopDocxToOneDrive } = await import("@/lib/sop/storage");

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
// SOI, an APP0 segment, then SOF0 for 640×480
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00]);

const brief: SopBrief = { title: "Bank reconciliation", department: "ACCOUNTS", workCategory: "Books", objective: "o", scope: "s", keySteps: [], rolesInvolved: [], references: [], subProcesses: ["Match"] };
const frame = { purpose: "p", scope: "s", definitions: [], responsibilities: [], kpis: [], risks: [], references: [] };
const step = (action: string) => ({ role: "Assistant", action, system: "Tally Prime", input: "", output: "", ifThen: [], check: "", checkType: "" });
const sop = (...actions: string[]): SopContent => assembleSop(brief, { effectiveDate: "12/11/2026", revision: "1.0" }, frame, [{ name: "Match", draft: { objective: "o", owner: "Senior", steps: actions.map(step), toConfirm: [] } }]);

describe("imageSize", () => {
  it("reads PNG and JPEG sizes from the header", () => {
    expect(imageSize(PNG)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(imageSize(JPEG)).toEqual({ mime: "image/jpeg", width: 640, height: 480 });
  });
  it("refuses anything else, a cut-off file, or a zero size", () => {
    expect(imageSize(new TextEncoder().encode("GIF89a........................"))).toBeNull();
    expect(imageSize(JPEG.subarray(0, 12))).toBeNull();
    const flat = PNG.slice();
    flat.set([0, 0, 0, 0], 16);
    expect(imageSize(flat)).toBeNull();
  });
});

describe("fitBox", () => {
  it("shrinks to the page, keeps the shape, never enlarges", () => {
    expect(fitBox(1600, 900)).toEqual({ width: 836, height: 470 });
    expect(fitBox(400, 300)).toEqual({ width: 400, height: 300 });
  });
});

describe("applyScreens", () => {
  const c = sop("Open the ledger", "Tick the entries");
  it("puts screens on the named steps and takes them off the rest", () => {
    const withTwo = applyScreens(c, { "P01.1": [{ imageId: "a", caption: "Ledger" }], "P01.2": [{ imageId: "b", caption: "" }] });
    if ("error" in withTwo) throw new Error(withTwo.error);
    expect(screenIds(withTwo.content)).toEqual(["a", "b"]);
    const withOne = applyScreens(withTwo.content, { "P01.2": [{ imageId: "b", caption: "" }] });
    if ("error" in withOne) throw new Error(withOne.error);
    expect(screenIds(withOne.content)).toEqual(["b"]);
    expect(JSON.parse(JSON.stringify(withOne.content)).subProcesses[0].steps[0].screens).toBeUndefined();
  });
  it("refuses a step that is not in the SOP", () => {
    expect(applyScreens(c, { "P09.1": [{ imageId: "a", caption: "" }] })).toEqual({ error: expect.stringContaining("P09.1") });
  });
});

describe("carryScreens", () => {
  const before = applyScreens(sop("Open the ledger", "Tick the entries", "Print"), { "P01.1": [{ imageId: "a", caption: "" }], "P01.2": [{ imageId: "b", caption: "" }], "P01.3": [{ imageId: "c", caption: "" }] });
  if ("error" in before) throw new Error(before.error);
  it("keeps screens by step number and flags rewritten and missing steps", () => {
    const after = carryScreens(before.content, sop("Open the ledger", "Tick every cleared entry"));
    expect(after.subProcesses![0].steps.map((s) => s.screens?.map((x) => x.imageId))).toEqual([["a"], ["b"]]);
    expect(after.openPoints).toEqual([expect.stringMatching(/^P01\.2: this step was rewritten/), expect.stringMatching(/^Screens for P01\.3 were left out/)]);
  });
  it("changes nothing when the last version had no screens", () => {
    const next = sop("Open the ledger");
    expect(carryScreens(sop("Open the ledger"), next)).toBe(next);
    expect(carryScreens(undefined, next)).toBe(next);
  });
});

const media = (zip: JSZip) => Object.values(zip.files).filter((f) => f.name.startsWith("word/media/") && !f.dir);

describe("renderSopDocx with screens", () => {
  it("embeds the picture under its step with a caption", async () => {
    const c = applyScreens(sop("Open the ledger"), { "P01.1": [{ imageId: "a", caption: "Ledger list" }] });
    if ("error" in c) throw new Error(c.error);
    const docx = await renderSopDocx(c.content, new Map([["a", { mime: "image/png", bytes: PNG, width: 1, height: 1 }]]));
    const zip = await JSZip.loadAsync(docx);
    expect(media(zip)).toHaveLength(1);
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Screen P01.1 — Ledger list");
  });
  it("leaves out a screen whose picture is missing instead of failing", async () => {
    const c = applyScreens(sop("Open the ledger"), { "P01.1": [{ imageId: "gone", caption: "x" }] });
    if ("error" in c) throw new Error(c.error);
    const zip = await JSZip.loadAsync(await renderSopDocx(c.content));
    expect(media(zip)).toHaveLength(0);
  });
});

describe("saveSopDocxToOneDrive", () => {
  const save = (folderId: string | null, department = "ACCOUNTS") => saveSopDocxToOneDrive({ folderId, department, title: "Bank reconciliation", versionNumber: 2, docx: Buffer.from("PK"), userId: "u1" });
  beforeEach(() => {
    vi.stubEnv("GRAPH_DRIVE_ID", "drive");
    vi.stubEnv("GRAPH_VIDEOS_FOLDER_PATH", "L&D");
    for (const f of Object.values(graph)) f.mockClear();
  });

  it("makes the SOP's own folder the first time and replaces the same version's file", async () => {
    graph.getDriveItem.mockResolvedValue(null);
    expect(await save(null)).toEqual({ folderId: "new-folder", itemId: "file-1", webUrl: "https://onedrive.test/file-1" });
    expect(graph.createFolderIn).toHaveBeenCalledWith("drive", "L&D/SOP/Accounts", "Bank reconciliation", "t");
    expect(graph.uploadFileToFolderId).toHaveBeenCalledWith("drive", "new-folder", "Bank reconciliation_v2.docx", expect.any(ArrayBuffer), "t", "replace");
  });
  it("reuses its folder by id, and moves it when the SOP changes department", async () => {
    graph.getDriveItem.mockResolvedValue({ id: "f1", name: "Bank reconciliation", parentId: "L&D/SOP/Accounts" });
    expect((await save("f1")).folderId).toBe("f1");
    expect(graph.createFolderIn).not.toHaveBeenCalled();
    expect(graph.moveDriveItem).not.toHaveBeenCalled();
    await save("f1", "TAX");
    expect(graph.moveDriveItem).toHaveBeenCalledWith("drive", "f1", "L&D/SOP/Tax", "t");
  });
  it("uses the folder another save recorded first, not the one it just made", async () => {
    graph.getDriveItem.mockResolvedValue(null);
    const claim = vi.fn(async () => "their-folder");
    const r = await saveSopDocxToOneDrive({ folderId: null, claimFolder: claim, department: "ACCOUNTS", title: "Bank reconciliation", versionNumber: 1, docx: Buffer.from("PK"), userId: "u1" });
    expect(claim).toHaveBeenCalledWith("new-folder");
    expect(r.folderId).toBe("their-folder");
    expect(graph.uploadFileToFolderId).toHaveBeenCalledWith("drive", "their-folder", "Bank reconciliation_v1.docx", expect.any(ArrayBuffer), "t", "replace");
  });
  it("makes a new folder when someone deleted the old one", async () => {
    graph.getDriveItem.mockResolvedValue(null);
    expect((await save("deleted")).folderId).toBe("new-folder");
  });
  it("keeps the folder it made when the upload fails, so a retry does not make another", async () => {
    graph.getDriveItem.mockResolvedValue(null);
    graph.uploadFileToFolderId.mockResolvedValueOnce(null);
    expect(await save(null)).toEqual({ folderId: "new-folder", itemId: null, webUrl: null });
    graph.uploadFileToFolderId.mockRejectedValueOnce(new Error("Graph 503"));
    graph.getDriveItem.mockResolvedValue({ id: "new-folder", name: "x", parentId: "L&D/SOP/Accounts" });
    expect(await save("new-folder")).toEqual({ folderId: "new-folder", itemId: null, webUrl: null });
    expect(graph.createFolderIn).toHaveBeenCalledTimes(1);
  });
});

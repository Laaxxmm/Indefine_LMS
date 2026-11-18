// Re-audit NEW-6: the course-handout and live-session material uploads moved from server actions
// (which needed serverActions.bodySizeLimit = 51 MB on every page) to route handlers that read a
// capped multipart body and screen each file. Admin only, same-site only, audited without file names.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./harness";

const db = {
  materials: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
};
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    video: { findUnique: async () => ({ id: "v1", graphDriveId: "d1", graphItemId: "i1" }) },
    material: {
      count: async () => db.materials.length,
      create: async (a: { data: Record<string, unknown> }) => (db.materials.push(a.data), { id: `m${db.materials.length}` }),
    },
    account: { findFirst: async () => null },
    auditEvent: { create: async (a: { data: Record<string, unknown> }) => (db.audits.push(a.data), { id: "a1" }) },
  },
}));
const uploads: { name: string; size: number }[] = [];
vi.mock("@/lib/graph", () => ({
  getAppOnlyToken: async () => "tok",
  getUserGraphToken: async () => null,
  getItemParentId: async () => "folder-1",
  resolveFolderId: async () => null,
  uploadFileToFolderId: async (_d: string, _f: string, name: string, bytes: ArrayBuffer) => (uploads.push({ name, size: bytes.byteLength }), { id: "item-9", size: bytes.byteLength }),
}));
const scheduled: unknown[] = [];
vi.mock("@/lib/live/schedule", () => ({ scheduleRecurring: async (...args: unknown[]) => void scheduled.push(args) }));

const { auth } = await import("@/lib/auth");
const as = (u: Parameters<typeof activeSession>[0] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? activeSession(u) : null);
const handout = await import("@/app/api/admin/video/[id]/materials/route");
const live = await import("@/app/api/admin/live/schedule/route");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
function form(files: [string, string, Uint8Array<ArrayBuffer>][], fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const f = new FormData();
  for (const [field, name, bytes] of files) f.append(field, new File([bytes], name, { type: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" }));
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return new Request("https://lms.example/api/x", { method: "POST", body: f, headers: { origin: "https://lms.example", host: "lms.example", ...headers } });
}
const params = { params: Promise.resolve({ id: "v1" }) };

beforeEach(() => {
  db.materials.length = 0;
  db.audits.length = 0;
  uploads.length = 0;
  scheduled.length = 0;
});

describe("POST /api/admin/video/[id]/materials (was a server action)", () => {
  it("admins only", async () => {
    as({ role: "EMPLOYEE" });
    expect((await handout.POST(form([["file", "notes.pdf", PDF]]), params)).status).toBe(403);
    as(null);
    expect((await handout.POST(form([["file", "notes.pdf", PDF]]), params)).status).toBe(403);
  });

  it("refuses a form posted from another site", async () => {
    as({ role: "ADMIN" });
    expect((await handout.POST(form([["file", "notes.pdf", PDF]], {}, { origin: "https://evil.example" }), params)).status).toBe(403);
    expect((await handout.POST(form([["file", "notes.pdf", PDF]], {}, { "sec-fetch-site": "cross-site" }), params)).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("uploads a screened file beside the video, audits without the file name, and redirects back", async () => {
    as({ role: "ADMIN" });
    const res = await handout.POST(form([["file", "Rajesh_Kumar_handout.pdf", PDF]]), params);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/video/v1?matinfo=Material%20attached.");
    expect(uploads).toEqual([{ name: "Rajesh_Kumar_handout.pdf", size: PDF.length }]);
    expect(db.audits[0]).toMatchObject({ action: "attach-material", entity: "Material" });
    expect(JSON.stringify(db.audits)).not.toContain("Rajesh");
  });

  it("a file type outside the list, or content that does not match its name, is refused before any upload", async () => {
    as({ role: "ADMIN" });
    const exe = await handout.POST(form([["file", "setup.exe", new Uint8Array([0x4d, 0x5a, 1, 2])]]), params);
    expect(exe.status).toBe(303);
    expect(decodeURIComponent(exe.headers.get("location") ?? "")).toMatch(/file type is not accepted/);
    const fake = await handout.POST(form([["file", "slides.pdf", new Uint8Array([1, 2, 3, 4, 5, 6])]]), params);
    expect(decodeURIComponent(fake.headers.get("location") ?? "")).toMatch(/does not look like a \.pdf file/);
    expect(uploads).toHaveLength(0);
  });
});

describe("POST /api/admin/live/schedule (was a server action)", () => {
  const fields = { title: "GST update", courseTitle: "GST", startLocal: "2026-11-20T10:00", durationMin: "60" };

  it("schedules with the screened materials and redirects to the sessions tab", async () => {
    as({ role: "ADMIN" });
    const res = await live.POST(form([["materials", "deck.pdf", PDF]], fields));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/live?tab=sessions&scheduled=1");
    const [input] = scheduled[0] as [{ title: string; materials: { name: string; bytes: ArrayBuffer }[] }];
    expect(input.title).toBe("GST update");
    expect(input.materials.map((m) => [m.name, m.bytes.byteLength])).toEqual([["deck.pdf", PDF.length]]);
    expect(db.audits[0]).toMatchObject({ action: "schedule-live-session", entity: "LiveSession" });
  });

  it("one refused file stops the whole schedule (nothing half-done)", async () => {
    as({ role: "ADMIN" });
    const res = await live.POST(form([["materials", "deck.pdf", PDF], ["materials", "run.bat", new Uint8Array([1, 2, 3])]], fields));
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/error=.*Nothing was scheduled/);
    expect(scheduled).toHaveLength(0);
  });

  it("admins only, same site only", async () => {
    as({ role: "EMPLOYEE" });
    expect((await live.POST(form([], fields))).status).toBe(403);
    as({ role: "ADMIN" });
    expect((await live.POST(form([], fields, { origin: "https://evil.example" }))).status).toBe(403);
    expect(scheduled).toHaveLength(0);
  });
});

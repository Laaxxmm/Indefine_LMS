// Security audit finding B (legacy LMS routes):
//  - job inline edits: the client's handler, the job's handler or management only, audited with
//    masked before / after; client edits audited the same way;
//  - the all-clients report download: management only, audited;
//  - every multipart upload (client documents, tax tools, engagement-letter PDFs) is capped before
//    its body is read and screened against a type allowlist (no .exe / .html).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./harness";

const db = vi.hoisted(() => ({
  audits: [] as Record<string, unknown>[],
  jobUpdates: [] as unknown[],
  clientUpdates: [] as unknown[],
  reads: [] as string[],
  job: { id: "j1", handlerId: "u-handler", status: "IN_PROGRESS", dueOn: null as Date | null, fees: null as unknown, notes: "Call Kiran on 9876543210", client: { primaryHandlerId: "u-primary" } },
  client: { id: "c1", name: "Kumar Traders", folderName: "Kumar Traders", pan: "ABCPK1234F", gstin: null, contactPhone: "9876543210", contactEmail: "kiran@kumartraders.test", contactName: "Kiran Kumar", city: "Hubballi", turnover: 100, active: true },
}));
const uploads = vi.hoisted(() => ({ client: [] as { name: string; size: number }[], letter: 0, taxFiles: [] as string[] }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findUnique: async (a: { where: { id: string } }) => (db.reads.push("job"), a.where.id === db.job.id ? structuredClone(db.job) : null),
      updateMany: async (a: unknown) => (db.jobUpdates.push(a), { count: 1 }),
    },
    client: {
      findUnique: async (a: { where: { id: string } }) => (db.reads.push("client"), a.where.id === db.client.id ? structuredClone(db.client) : null),
      findFirst: async () => null,
      update: async (a: unknown) => (db.clientUpdates.push(a), {}),
    },
    user: { findUnique: async () => ({ active: true }) },
    auditEvent: { create: async (a: { data: Record<string, unknown> }) => (db.audits.push(a.data), { id: `ae-${db.audits.length}` }) },
    engagementLetter: { findUnique: async () => ({ id: "el1", clientName: "Zenith", fy: "26-27", status: "DRAFT" }), update: async () => ({}) },
    engagementLetterEvent: { create: async () => ({}) },
  },
}));
const workbook = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/clients/workbook", () => ({ scheduleWorkbookRebuild: vi.fn(), rebuildClientWorkbook: async () => (workbook.ok ? { ok: true } : { ok: false, error: "Graph not configured" }) }));
vi.mock("@/lib/clients/storage", () => ({
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  renameClientFolder: async () => true,
  uploadClientDocument: async (i: { file: File }) => (uploads.client.push({ name: i.file.name, size: i.file.size }), { id: `d${uploads.client.length}`, name: i.file.name, webUrl: "https://sp/x" }),
}));
vi.mock("@/lib/clients/reports", async (orig) => ({ ...(await orig<typeof import("@/lib/clients/reports")>()), loadJobRows: async () => [] }));
vi.mock("@/lib/office-tools/access", () => ({ canUseOfficeTools: () => true }));
vi.mock("@/lib/office-tools/audit", () => ({ recordToolRun: async () => {} }));
vi.mock("@/lib/office-tools/tax", () => ({
  XLSX_MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  TAX_PROCESSORS: { gstr3b: { filename: "gstr3b", build: async (files: { name: string }[]) => (uploads.taxFiles.push(...files.map((f) => f.name)), { bytes: Buffer.from("xlsx"), count: files.length }) } },
}));
vi.mock("@/lib/office-tools/engagement-letters", async (orig) => ({
  ...(await orig<typeof import("@/lib/office-tools/engagement-letters")>()),
  uploadLetterPdf: async () => (uploads.letter++, { id: "item", webUrl: "https://sp/el", driveId: "d" }),
}));

const { auth } = await import("@/lib/auth");
const jobRoute = await import("@/app/api/clients/jobs/[jobId]/route");
const clientRoute = await import("@/app/api/clients/[id]/route");
const reportRoute = await import("@/app/api/clients/reports/export/route");
const workbookRoute = await import("@/app/api/clients/workbook/route");
const docsRoute = await import("@/app/api/clients/[id]/documents/route");
const taxRoute = await import("@/app/api/tools/office-tools/tax/[tool]/route");
const letterRoute = await import("@/app/api/tools/engagement-letters/[id]/file/route");

const as = (o: Parameters<typeof activeSession>[0]) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession(o));
const patch = (body: unknown) => new Request("http://x/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) });
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n1 0 obj\n");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
const multipart = (files: File[], fields: Record<string, string>, field = "files", headers: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const f of files) fd.append(field, f);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x/api", { method: "POST", body: fd, headers });
};

beforeEach(() => {
  db.audits.length = 0;
  db.jobUpdates.length = 0;
  db.clientUpdates.length = 0;
  db.reads.length = 0;
  uploads.client.length = 0;
  uploads.letter = 0;
  uploads.taxFiles.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("job inline edits (PATCH /api/clients/jobs/[jobId])", () => {
  it("staff who neither handle the client nor the job are refused, with nothing changed", async () => {
    as({ id: "u-other" });
    const r = await jobRoute.PATCH(patch({ status: "DELIVERED" }), p({ jobId: "j1" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("Only the client's handler, the job's handler, an admin or a partner can change this job. Ask one of them.");
    expect(db.jobUpdates).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("the job's handler, the client's primary handler and management may edit; each edit is audited with masked before / after", async () => {
    for (const who of [{ id: "u-handler" }, { id: "u-primary" }, { id: "u-partner", level: "PARTNER" }, { id: "u-admin", role: "ADMIN" as const }]) {
      as(who);
      expect((await jobRoute.PATCH(patch({ status: "DELIVERED" }), p({ jobId: "j1" }))).status, who.id).toBe(200);
    }
    as({ id: "u-handler" });
    db.audits.length = 0;
    await jobRoute.PATCH(patch({ notes: "Kiran's new number is 9123456780", status: "IN_PROGRESS" }), p({ jobId: "j1" }));
    expect(db.audits).toHaveLength(1);
    const a = db.audits[0] as { actorId: string; action: string; entity: string; entityId: string; meta: { changes: { field: string; before: unknown; after: unknown }[] } };
    expect(a).toMatchObject({ actorId: "u-handler", action: "update", entity: "Job", entityId: "j1" });
    const notes = a.meta.changes.find((c) => c.field === "notes")!;
    expect(String(notes.before)).toMatch(/^\[text, \d+ characters, #[0-9a-f]{6}\]$/);
    expect(JSON.stringify(a)).not.toMatch(/9876543210|9123456780|Kiran/);
    expect(a.meta.changes.map((c) => c.field)).toEqual(["notes"]); // status unchanged: not recorded
  });
});

describe("client edits (PATCH /api/clients/[id])", () => {
  it("stay management-only and are audited with identifiers masked to the last 4", async () => {
    as({ id: "u-staff" });
    expect((await clientRoute.PATCH(patch({ city: "Dharwad" }), p({ id: "c1" }))).status).toBe(403);
    as({ id: "u-partner", level: "PARTNER" });
    expect((await clientRoute.PATCH(patch({ pan: "ABCPK9999F", contactEmail: "kiran@new.test", city: "Dharwad" }), p({ id: "c1" }))).status).toBe(200);
    const a = db.audits[0] as { entity: string; meta: { changes: { field: string; before: unknown; after: unknown }[] } };
    expect(a.entity).toBe("Client");
    expect([...a.meta.changes].sort((x, y) => x.field.localeCompare(y.field))).toEqual([
      { field: "city", before: "Hubballi", after: "Dharwad" },
      { field: "contactEmail", before: "****test", after: "****test" },
      { field: "pan", before: "****234F", after: "****999F" },
    ]);
    expect(JSON.stringify(db.audits)).not.toMatch(/ABCPK1234F|ABCPK9999F|kiran@/);
  });
});

describe("all-clients report download", () => {
  it("is management only, and each download is audited", async () => {
    as({ id: "u-staff" });
    const staff = await reportRoute.GET(new Request("http://x/api/clients/reports/export?fy=2026-27"));
    expect(staff.status).toBe(403);
    expect((await staff.json()).error).toBe("Only admins and partners can download the all-clients report. Ask one of them for a copy.");
    as({ id: "u-partner", level: "PARTNER" });
    const ok = await reportRoute.GET(new Request("http://x/api/clients/reports/export?fy=2026-27"));
    expect(ok.status).toBe(200);
    // A read audit (src/lib/audit/reads.ts): row count and filter names, never their values.
    expect(db.audits).toEqual([{ actorId: "u-partner", action: "export", entity: "Client", entityId: null, meta: { what: "client-jobs-report", rows: 0, format: "xlsx", filters: ["fy"] } }]);
    await reportRoute.GET(new Request("http://x/api/clients/reports/export?fy=2026-27"));
    expect(db.audits).toHaveLength(2); // every download, no deduplication
  });
});

describe("all-clients workbook rebuild", () => {
  it("a successful rebuild is recorded as an export (every time); a failed one records nothing", async () => {
    as({ id: "u-staff" });
    workbook.ok = true;
    const ok = await workbookRoute.POST();
    expect(ok.status).toBe(200);
    expect(db.audits).toEqual([{ actorId: "u-staff", action: "export", entity: "Client", entityId: null, meta: { what: "client-workbook" } }]);
    await workbookRoute.POST();
    expect(db.audits).toHaveLength(2);
    workbook.ok = false;
    expect((await workbookRoute.POST()).status).toBe(502);
    expect(db.audits).toHaveLength(2);
  });
});

describe("multipart uploads are capped and screened", () => {
  it("client documents: a PDF is stored; .exe, .html and a renamed executable are refused per file and never stored", async () => {
    as({ id: "u-staff" });
    const r = await docsRoute.POST(
      multipart([new File([PDF], "pan.pdf", { type: "application/pdf" }), new File([EXE], "setup.exe"), new File([enc("<html></html>")], "x.html", { type: "text/html" }), new File([EXE], "renamed.pdf")], { docType: "PAN" }),
      p({ id: "c1" }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(uploads.client.map((u) => u.name)).toEqual(["pan.pdf"]);
    expect(body.failed.map((f: { name: string }) => f.name)).toEqual(["setup.exe", "x.html", "renamed.pdf"]);
    expect(body.failed[0].error).toMatch(/\.exe file type is not accepted/);
  });

  it("client documents: only refused files → 415; a body declared over the cap is refused before it is read or any record is looked up", async () => {
    as({ id: "u-staff" });
    const only = await docsRoute.POST(multipart([new File([EXE], "setup.exe")], { docType: "PAN" }), p({ id: "c1" }));
    expect(only.status).toBe(415);
    db.reads.length = 0;
    const huge = await docsRoute.POST(multipart([new File([PDF], "pan.pdf")], { docType: "PAN" }, "files", { "content-length": String(2 * 1024 * 1024 * 1024) }), p({ id: "c1" }));
    expect(huge.status).toBe(413);
    expect(db.reads).toEqual([]);
    expect(uploads.client).toEqual([]);
  });

  it("tax tools: PDFs only (content checked); anything else is refused before processing", async () => {
    as({ id: "u-staff" });
    const bad = await taxRoute.POST(multipart([new File([PDF], "a.pdf"), new File([enc("<html></html>")], "b.html")], {}), p({ tool: "gstr3b" }));
    expect(bad.status).toBe(415);
    expect((await bad.json()).error).toMatch(/^b\.html: \.html file type is not accepted\. Upload PDF only\.\. Upload the return PDFs only\.$|^b\.html: /);
    expect(uploads.taxFiles).toEqual([]);
    const ok = await taxRoute.POST(multipart([new File([PDF], "a.pdf")], {}), p({ tool: "gstr3b" }));
    expect(ok.status).toBe(200);
    expect(uploads.taxFiles).toEqual(["a.pdf"]);
  });

  it("engagement letters: a non-PDF and an over-limit PDF are refused; a PDF is uploaded", async () => {
    as({ id: "u-staff" });
    const notPdf = await letterRoute.POST(multipart([new File([EXE], "letter.pdf")], { kind: "draft" }, "file"), p({ id: "el1" }));
    expect(notPdf.status).toBe(400);
    expect((await notPdf.json()).error).toBe("That file is not a PDF");
    // Browsers send Content-Length: an over-limit body is refused before it is read.
    const big = await letterRoute.POST(multipart([new File([PDF], "letter.pdf")], { kind: "draft" }, "file", { "content-length": String(4 * 1024 * 1024) }), p({ id: "el1" }));
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatch(/^The PDF is over the 3 MB limit\./);
    const html = await letterRoute.POST(multipart([new File([enc("<html></html>")], "letter.html")], { kind: "draft" }, "file"), p({ id: "el1" }));
    expect(html.status).toBe(400);
    expect(uploads.letter).toBe(0);
    expect((await letterRoute.POST(multipart([new File([PDF], "letter.pdf")], { kind: "draft" }, "file"), p({ id: "el1" }))).status).toBe(200);
    expect(uploads.letter).toBe(1);
  });
});

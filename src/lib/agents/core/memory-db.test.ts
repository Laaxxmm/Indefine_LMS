import { describe, expect, it } from "vitest";
import { createMemoryDb, UniqueConstraintError } from "./memory-db";
import { combineInputSources, emptyInputSource, InputTooLargeError, staticInputSource, defaultInputSource } from "./inputs";
import { checkWorkbookShape, previewWorkbook } from "./preview";
import { buildWorkbook } from "./templates";
import { echoWorld, CLIENT_DOCS } from "../../../../tests/fakes/agent-world";
import type { InputRequest } from "./runner";

const T = new Date("2026-11-05T00:00:00Z");

function db() {
  const d = createMemoryDb({ now: () => T });
  d.seed("client", [{ id: "c1", name: "Acme" }]);
  d.seed("firmClient", [{ id: "fc1", lmsClientId: "c1", clientCode: "ACME01" }]);
  d.seed("jobTask", [
    { id: "j1", firmClientId: "fc1", service: "GST", fy: "2026-27", period: "Q1", title: "A", state: "IN_REVIEW", assigneeId: "u1" },
    { id: "j2", firmClientId: "fc1", service: "GST", fy: "2026-27", period: "Q2", title: "B", state: "DRAFT", reviewerId: "u1" },
    { id: "j3", firmClientId: "fc1", service: "ROC", fy: "2026-27", period: "Annual", title: "C", state: "DONE", assigneeId: "u2" },
  ]);
  return d;
}

describe("memory db", () => {
  it("filters with equality, in/notIn/not, ranges, contains, OR/AND/NOT and relations", async () => {
    const d = db();
    const ids = async (where: object) => (await d.jobTask.findMany({ where, orderBy: { id: "asc" } } as never) as { id: string }[]).map((r) => r.id);
    expect(await ids({ service: "GST" })).toEqual(["j1", "j2"]);
    expect(await ids({ state: { in: ["DRAFT", "DONE"] } })).toEqual(["j2", "j3"]);
    expect(await ids({ state: { notIn: ["DRAFT"] } })).toEqual(["j1", "j3"]);
    expect(await ids({ state: { not: "DONE" } })).toEqual(["j1", "j2"]);
    expect(await ids({ OR: [{ assigneeId: "u1" }, { reviewerId: "u1" }] })).toEqual(["j1", "j2"]);
    expect(await ids({ AND: [{ service: "GST" }, { state: "DRAFT" }] })).toEqual(["j2"]);
    expect(await ids({ NOT: { service: "GST" } })).toEqual(["j3"]);
    expect(await ids({ title: { contains: "b" } })).toEqual(["j2"]);
    expect(await ids({ createdAt: { gte: T, lte: T } })).toEqual(["j1", "j2", "j3"]);
    expect(await ids({ createdAt: { lt: T } })).toEqual([]);
    expect(await ids({ createdAt: { gt: new Date(0) } })).toHaveLength(3);
    expect(await ids({ reviewerId: null })).toEqual(["j1", "j3"]);
    expect(await ids({ firmClient: { clientCode: "ACME01" } })).toHaveLength(3);
    await d.agentRun.create({ data: { id: "r1", jobTaskId: "j1", agent: "echo", sopPackVersion: "1", status: "RUNNING" } } as never);
    expect(await ids({ agentRuns: { some: { status: "RUNNING" } } })).toEqual(["j1"]);
    expect(await ids({ agentRuns: { none: { status: "RUNNING" } } })).toEqual(["j2", "j3"]);
    expect(await ids({ title: { equals: "C" } })).toEqual(["j3"]);
    expect((await d.agentRun.findMany({ where: { jobTask: { assigneeId: "u1" } } } as never)).length).toBe(1);
  });

  it("select / include through relations, _count, take / skip, findFirst ordering", async () => {
    const d = db();
    await d.agentRun.create({ data: { id: "r1", jobTaskId: "j1", agent: "echo", sopPackVersion: "1", status: "AGENT_DONE" } } as never);
    const j = (await d.jobTask.findUnique({
      where: { id: "j1" },
      select: { id: true, firmClient: { select: { clientCode: true, client: { select: { name: true } } } }, agentRuns: { where: { status: "AGENT_DONE" }, take: 1, orderBy: { startedAt: "desc" }, select: { id: true } }, _count: { select: { agentRuns: true } } },
    } as never)) as Record<string, unknown>;
    expect(j).toEqual({ id: "j1", firmClient: { clientCode: "ACME01", client: { name: "Acme" } }, agentRuns: [{ id: "r1" }], _count: { agentRuns: 1 } });
    const inc = (await d.agentRun.findFirst({ include: { jobTask: true } } as never)) as unknown as { jobTask: { id: string } };
    expect(inc.jobTask.id).toBe("j1");
    expect(((await d.jobTask.findMany({ orderBy: [{ service: "desc" }, { id: "asc" }], skip: 1, take: 1 } as never)) as { id: string }[])[0].id).toBe("j1");
    expect(await d.jobTask.findFirst({ where: { id: "zz" } } as never)).toBeNull();
    expect(await d.jobTask.findUnique({ where: { id: "zz" } } as never)).toBeNull();
    await expect(d.jobTask.findUniqueOrThrow({ where: { id: "zz" } } as never)).rejects.toThrow(/not found/);
    expect(((await d.jobTask.findUniqueOrThrow({ where: { id: "j1" } } as never)) as { id: string }).id).toBe("j1");
    const none = (await d.deliverable.findFirst({ include: { agentRun: true } } as never)) as null;
    expect(none).toBeNull();
  });

  it("writes: defaults, updatedAt, increment, updateMany counts, unique constraints, rollback", async () => {
    const d = db();
    const run = (await d.agentRun.create({ data: { jobTaskId: "j1", agent: "echo", sopPackVersion: "1", status: "RUNNING" } } as never)) as Record<string, unknown>;
    expect(run).toMatchObject({ attempt: 1, needsPartnerReview: false, error: null });
    expect(String(run.id)).toMatch(/^mem-/);
    await d.agentRun.update({ where: { id: run.id }, data: { attempt: { increment: 2 } } } as never);
    expect(d.tables.agentRun[0].attempt).toBe(3);
    const before = d.tables.jobTask[0].updatedAt as Date;
    expect(await d.jobTask.updateMany({ where: { service: "GST" }, data: { title: "x", ackRef: undefined } } as never)).toEqual({ count: 2 });
    expect((d.tables.jobTask[0].updatedAt as Date).getTime()).toBeGreaterThan(before.getTime());
    await expect(d.jobTask.update({ where: { id: "zz" }, data: {} } as never)).rejects.toThrow(/not found/);
    expect(await d.checklistResult.createMany({ data: [{ agentRunId: "r", ruleId: "a", severity: "info", status: "pass", message: "m", source: "llm" }] } as never)).toEqual({ count: 1 });
    expect(await d.checklistResult.count({ where: { status: "pass" } } as never)).toBe(1);
    d.seed("sopPack", [{ key: "k", version: "1.0.0", major: 1, minor: 0, title: "K" }]);
    await expect(d.sopPack.create({ data: { key: "k", version: "1.0.0", major: 1, minor: 0, title: "K" } } as never)).rejects.toBeInstanceOf(UniqueConstraintError);
    await expect(
      d.$transaction(async (tx) => {
        await tx.auditEvent.create({ data: { action: "x", entity: "y" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(d.tables.auditEvent).toHaveLength(0);
    // nested transactions share the outer one; array form resolves all
    await d.$transaction(async () => d.$transaction(async (t2) => t2.auditEvent.create({ data: { action: "x", entity: "y" } })));
    expect(d.tables.auditEvent).toHaveLength(1);
    expect(await d.$transaction([d.auditEvent.count(), d.jobTask.count()] as never)).toEqual([1, 3]);
  });

  it("default clock and ids", async () => {
    const d = createMemoryDb();
    const r = (await d.auditEvent.create({ data: { action: "a", entity: "b" } } as never)) as { id: string; createdAt: Date };
    expect(r.id).toBe("mem-1");
    expect(r.createdAt).toBeInstanceOf(Date);
  });
});

const REQ: InputRequest = { agent: "echo", jobTaskId: "job-1", clientCode: "ACME01", fy: "2026-27", service: "Books", period: "2026-10", clientDocsFolder: CLIENT_DOCS };

describe("input sources", () => {
  it("combine, static copies, empty, size limit", async () => {
    const a = staticInputSource([{ name: "a.csv", source: "upload", bytes: Buffer.from("12345") }]);
    const got = await combineInputSources([a, emptyInputSource, a]).gather(REQ);
    expect(got.map((f) => f.name)).toEqual(["a.csv", "a.csv"]);
    await expect(combineInputSources([a, a], 8).gather(REQ)).rejects.toBeInstanceOf(InputTooLargeError);
  });

  it("ClientDocs: files only, none when the folder is missing, size limit while listing", async () => {
    const w = echoWorld();
    w.fake.addFolder(w.drive, `${CLIENT_DOCS}/sub`);
    w.fake.addFile(w.drive, `${CLIENT_DOCS}/notes.txt`, "hello");
    const { createSharePointClient } = await import("@/lib/integrations/sharepoint/graph-client");
    const { clientDocsInputSource } = await import("./inputs");
    const client = createSharePointClient({ fetch: w.fake.fetch, graphToken: async () => "t", sleep: async () => {} });
    const src = defaultInputSource(client, w.deps.store);
    const files = await src.gather(REQ);
    expect(files.map((f) => [f.name, f.source, f.path])).toEqual([
      ["notes.txt", "client-docs", `${CLIENT_DOCS}/notes.txt`],
      ["register.csv", "client-docs", `${CLIENT_DOCS}/register.csv`],
    ]);
    expect(await src.gather({ ...REQ, clientDocsFolder: "FY2026-27/Books/2026-11/ClientDocs" })).toEqual([]);
    await expect(clientDocsInputSource(client, w.deps.store, 3).gather(REQ)).rejects.toBeInstanceOf(InputTooLargeError);
  });
});

describe("preview / shape", () => {
  const header = { title: "T", clientName: "Acme", clientCode: "ACME01", period: "Q1", fy: "2026-27", agentRunId: "r", version: 1, generatedAt: T };
  it("renders cells as display text, truncates and checks the fixed layout", async () => {
    const wb = await buildWorkbook({
      header,
      sheets: [
        { name: "Data", columns: [{ key: "a", header: "A" }, { key: "n", header: "N", type: "inr" }, { key: "d", header: "D", type: "date" }, { key: "i", header: "I", type: "integer" }], rows: [{ a: "x", n: 1234567.5, d: "2026-04-01", i: 3 }], totals: true },
      ],
    });
    const p = await previewWorkbook(wb.buffer, { maxRows: 12, maxCols: 3 });
    expect(p.sheets[0].truncated).toBe(true);
    expect(p.sheets[0].rows[11]).toEqual(["x", "12,34,567.50", "01 Apr 2026"]);
    expect(await checkWorkbookShape(wb.buffer, [{ name: "Data", columns: ["A", "N", "D", "I"] }])).toEqual([]);
    expect(await checkWorkbookShape(wb.buffer, ["Data"])).toEqual([]);
    const probs = await checkWorkbookShape(wb.buffer, [{ name: "Data", columns: ["A"] }, "Missing"]);
    expect(probs).toEqual([expect.stringMatching(/columns/), 'sheet "Missing" missing']);
    expect(await checkWorkbookShape(wb.buffer, [])).toEqual(["unexpected sheet(s): Data"]);
  });

  it("flags a workbook without the header block", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.getCell("A1").value = { richText: [{ text: "rich" }] };
    ws.getCell("B1").value = { formula: "1+1", result: 2 };
    ws.getCell("C1").value = { text: "link", hyperlink: "https://example.test" };
    ws.getCell("D1").value = { error: "#N/A" } as never;
    ws.getCell("E1").value = true;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await previewWorkbook(buf);
    expect(p.sheets[0].rows[0]).toEqual(["rich", "2", "link", "#N/A", "true"]);
    const probs = await checkWorkbookShape(buf, ["Data"]);
    expect(probs).toContain('sheet "Data": draft label missing');
    expect(probs).toContain('sheet "Data": header field "Client" missing');
    const empty = new ExcelJS.Workbook();
    empty.addWorksheet("Data");
    expect(await checkWorkbookShape(Buffer.from(await empty.xlsx.writeBuffer()), ["Data"])).toContain('sheet "Data": title row empty');
  });
});

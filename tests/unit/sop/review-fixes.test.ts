// SOP Builder review (PRs #74-77) fixes, through the real route handlers: the "no client details"
// confirmation is checked by the server (M1); every route writes an AuditEvent (M2); a leak-gate
// refusal reads as a plain sentence (M4); "Remove this screen" blanks the picture and re-files the
// Word files, and the image route never lets a browser keep a picture (H1); Generate is rate-limited
// and fails closed (L1); a saved SOP is never reported as failed over OneDrive (L2); the body cap
// fits a 3 MB screenshot (L3); the 300-screen cap counts only screens versions show (L4); OneDrive
// folder names are cleaned after the cut (L5). The database, Gemini and OneDrive are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "../routes/harness";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  sops: [] as Row[],
  versions: [] as Row[],
  images: [] as Row[],
  audits: [] as Row[],
  editors: [] as Row[],
  bucket: { count: 1, fail: false, keys: [] as string[] },
  calls: [] as string[],
}));

vi.mock("@/lib/prisma", () => {
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, c]) => {
      if (c === undefined) return true;
      if (c && typeof c === "object" && !(c instanceof Date)) {
        const o = c as Row;
        if ("in" in o) return (o.in as unknown[]).includes(row[k]);
        if ("not" in o) return o.not === null ? row[k] != null : row[k] !== o.not;
      }
      return (row[k] ?? null) === c;
    });
  const pick = (row: Row, select?: Row) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
  const byNumber = (desc: boolean) => (a: Row, b: Row) => (desc ? -1 : 1) * (Number(a.versionNumber) - Number(b.versionNumber));
  const table = (rows: () => Row[], prefix: string) => ({
    findUnique: async (a: { where: Row; select?: Row }) => {
      const r = rows().find((x) => matches(x, a.where));
      return r ? pick(r, a.select) : null;
    },
    findFirst: async (a: { where: Row; select?: Row; orderBy?: Row }) => {
      const list = rows().filter((x) => matches(x, a.where));
      if (a.orderBy && "versionNumber" in a.orderBy) list.sort(byNumber(a.orderBy.versionNumber === "desc"));
      return list[0] ? pick(list[0], a.select) : null;
    },
    findMany: async (a: { where?: Row; select?: Row; orderBy?: Row } = {}) => {
      const list = rows().filter((x) => matches(x, a.where));
      if (a.orderBy && "versionNumber" in a.orderBy) list.sort(byNumber(a.orderBy.versionNumber === "desc"));
      return list.map((r) => pick(r, a.select));
    },
    count: async (a: { where?: Row } = {}) => rows().filter((x) => matches(x, a.where)).length,
    create: async (a: { data: Row; select?: Row }) => {
      const r = { id: id(prefix), createdAt: new Date(), ...a.data };
      rows().push(r);
      return pick(r, a.select);
    },
    update: async (a: { where: Row; data: Row }) => {
      const r = rows().find((x) => matches(x, a.where));
      if (!r) throw new Error(`no ${prefix} row`);
      Object.assign(r, a.data);
      db.calls.push(`${prefix}.update`);
      return { ...r };
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      const list = rows().filter((x) => matches(x, a.where));
      for (const r of list) Object.assign(r, a.data);
      return { count: list.length };
    },
    upsert: async (a: { where: Row; create: Row }) => {
      const r = rows().find((x) => matches(x, a.where)) ?? (rows().push({ id: id(prefix), ...a.create }), rows()[rows().length - 1]);
      return { ...r };
    },
    deleteMany: async (a: { where: Row }) => {
      db.calls.push(`${prefix}.deleteMany`);
      const keep = rows().filter((x) => !matches(x, a.where));
      const count = rows().length - keep.length;
      rows().splice(0, rows().length, ...keep);
      return { count };
    },
  });
  const sopTable = table(() => db.sops, "sop");
  const prisma: Row = {
    sop: {
      ...sopTable,
      findUnique: async (a: { where: Row; select?: Row; include?: { versions?: { take?: number } } }) => {
        const r = db.sops.find((x) => x.id === a.where.id);
        if (!r) return null;
        if (a.include?.versions) {
          const versions = db.versions.filter((v) => v.sopId === r.id).sort(byNumber(true));
          return { ...r, versions: a.include.versions.take ? versions.slice(0, a.include.versions.take) : versions };
        }
        return pick(r, a.select);
      },
      create: async (a: { data: Row & { versions: { create: Row } } }) => {
        const { versions, ...data } = a.data;
        const sop = { id: id("sop"), graphFolderId: null, ...data };
        db.sops.push(sop);
        const v = { id: id("ver"), sopId: sop.id, graphItemId: null, graphWebUrl: null, graphFiledAt: null, createdAt: new Date(), ...versions.create };
        db.versions.push(v);
        return { ...sop, versions: [{ id: v.id }] };
      },
    },
    sopVersion: table(() => db.versions, "ver"),
    sopImage: table(() => db.images, "img"),
    sopEditor: table(() => db.editors, "editor"),
    user: { findUnique: async () => ({ level: "EXECUTIVE" }) },
    auditEvent: { create: async (a: { data: Row }) => (db.audits.push(a.data), { id: `ae-${db.audits.length}` }) },
    $queryRaw: async (_q: TemplateStringsArray, ...values: unknown[]) => {
      // RateLimitBucket upsert (src/lib/hardening/rate-limit.ts), or the SOP row lock in addVersion.
      if (typeof values[0] === "string" && values[0].startsWith("sop-generate:")) {
        db.bucket.keys.push(values[0]);
        if (db.bucket.fail) throw Object.assign(new Error("pool timeout"), { code: "P2024" });
        return [{ count: db.bucket.count, windowStart: new Date() }];
      }
      return [];
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
const ai = vi.hoisted(() => ({ analyze: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/sop/gemini", () => ({
  analyzeSopRequest: (...a: unknown[]) => ai.analyze(...a),
  generateSop: (...a: unknown[]) => ai.generate(...a),
  stripSecrets: (s: string) => s,
  stripBriefSecrets: <T>(b: T) => b,
}));
const drive = vi.hoisted(() => ({ save: vi.fn(), refile: vi.fn() }));
vi.mock("@/lib/sop/storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/sop/storage")>()),
  saveSopDocxToOneDrive: (...a: unknown[]) => drive.save(...a),
  refileSopDocx: (...a: unknown[]) => drive.refile(...a),
}));
vi.mock("@/lib/sop/render", () => ({ renderSopDocx: async () => Buffer.from("docx") }));

const { auth } = await import("@/lib/auth");
const as = (u: Parameters<typeof activeSession>[0] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? activeSession(u) : null);
const images = await import("@/app/api/tools/sop-builder/sops/[id]/images/route");
const image = await import("@/app/api/tools/sop-builder/sops/[id]/images/[imageId]/route");
const remove = await import("@/app/api/tools/sop-builder/sops/[id]/images/[imageId]/remove/route");
const analyze = await import("@/app/api/tools/sop-builder/analyze/route");
const sops = await import("@/app/api/tools/sop-builder/sops/route");
const versions = await import("@/app/api/tools/sop-builder/sops/[id]/versions/route");
const screens = await import("@/app/api/tools/sop-builder/sops/[id]/screens/route");
const onedrive = await import("@/app/api/tools/sop-builder/sops/[id]/versions/[versionId]/onedrive/route");
const { LegacyGateError } = await import("@/lib/ai/legacy-gate");
const { LEGACY_GATE_MESSAGE, failureSentence, messageProblems } = await import("@/lib/errors");
const { ONEDRIVE_LATER, staleInOneDrive } = await import("@/lib/sop/service");
const { sanitize } = await import("@/lib/sop/storage");
const { bodyLimitFor, checkBody } = await import("@/lib/hardening/body-limits");
const { MULTIPART_FRAMING_BYTES } = await import("@/lib/hardening/uploads");
const { SCREEN_MAX_BYTES, SCREENS_PER_SOP } = await import("@/lib/sop/screens");

const ADMIN = { id: "u-admin", role: "ADMIN" as const, level: "PARTNER" as const };
const PARTNER = { id: "u-partner", level: "PARTNER" as const };
const EDITOR = { id: "u-editor", department: "ACCOUNTS" as const };
// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const step = (no: string, imageIds: string[] = []) => ({ no, role: "Assistant", action: `Do ${no}`, system: "Tally", input: "", output: "", ifThen: [], control: "", ...(imageIds.length ? { screens: imageIds.map((imageId) => ({ imageId, caption: "" })) } : {}) });
const content = (...steps: ReturnType<typeof step>[]) => ({ schemaVersion: 2, title: "BRS", department: "ACCOUNTS", workCategory: "Books", effectiveDate: "18/11/2026", revision: "1.0", purpose: "p", scope: "s", definitions: [], responsibilities: [], flowchart: [], procedure: [], references: [], subProcesses: [{ code: "P01", name: "Match", objective: "", owner: "", steps }] });
const brief = { title: "BRS", department: "ACCOUNTS", workCategory: "Books", objective: "o", scope: "s", keySteps: [], rolesInvolved: [], references: [], subProcesses: ["Match"] };
const params = <T extends Row>(p: T) => ({ params: Promise.resolve(p) });
const json = (body: unknown) => new Request("https://lms.example/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const upload = (fields: Record<string, string>) => {
  const f = new FormData();
  f.append("file", new File([PNG], "screen.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return new Request("https://lms.example/api/x", { method: "POST", body: f });
};
const actions = () => db.audits.map((a) => a.action);

function seedSop(over: Row = {}) {
  db.sops.push({ id: "sop-1", title: "BRS", department: "ACCOUNTS", workCategory: "Books", graphFolderId: "folder-1", currentVersionId: "ver-a", ...over });
}
function seedVersion(id: string, versionNumber: number, c: unknown, over: Row = {}) {
  db.versions.push({ id, sopId: "sop-1", versionNumber, versionString: `v${versionNumber}`, purpose: "p", rawProcedure: "r", brief, content: c, graphItemId: null, graphWebUrl: null, graphFiledAt: null, createdById: "u-editor", creatorName: "E", creatorDesignation: "", createdAt: new Date(), ...over });
}
function seedImage(id: string, over: Row = {}) {
  db.images.push({ id, sopId: "sop-1", mime: "image/png", bytes: Uint8Array.from([1, 2, 3]), width: 1, height: 1, createdById: "u-editor", createdAt: new Date(), removedAt: null, removedById: null, ...over });
}

beforeEach(() => {
  for (const t of [db.sops, db.versions, db.images, db.audits, db.editors, db.calls, db.bucket.keys]) t.length = 0;
  db.bucket.count = 1;
  db.bucket.fail = false;
  ai.analyze.mockReset();
  ai.generate.mockReset();
  ai.generate.mockResolvedValue(content(step("P01.1")));
  drive.save.mockReset();
  drive.save.mockResolvedValue({ folderId: "folder-1", itemId: "file-new", webUrl: "https://onedrive.test/new" });
  drive.refile.mockReset();
  drive.refile.mockResolvedValue({ status: "replaced", webUrl: "https://onedrive.test/same" });
  db.editors.push({ id: "g1", userId: "u-editor" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("M1: the server refuses a screenshot sent without the 'no client details' confirmation", () => {
  it("400 with a plain sentence and nothing stored; with the confirmation it is stored and audited", async () => {
    seedSop();
    as(EDITOR);
    const refused = await images.POST(upload({}), params({ id: "sop-1" }));
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toBe("Confirm that no client details are visible in this screenshot (hide any first), then add it again.");
    expect(messageProblems(body.error)).toEqual([]);
    expect((await images.POST(upload({ noClientDetails: "no" }), params({ id: "sop-1" }))).status).toBe(400);
    expect(db.images).toHaveLength(0);

    const ok = await images.POST(upload({ noClientDetails: "yes" }), params({ id: "sop-1" }));
    expect(ok.status).toBe(201);
    expect(db.images).toHaveLength(1);
    expect(db.audits).toEqual([expect.objectContaining({ action: "sop.screen-upload", entity: "SopImage", entityId: db.images[0].id, actorId: "u-editor", meta: expect.objectContaining({ sopId: "sop-1", noClientDetailsConfirmed: true }) })]);
  });
});

describe("L4: the 300-screen cap counts the screens versions show", () => {
  it("screens never saved in a version (or removed) do not fill the cap; shown ones do", async () => {
    seedSop();
    as(EDITOR);
    const old = new Date(Date.now() - 3 * 86_400_000);
    for (let i = 0; i < SCREENS_PER_SOP; i++) seedImage(`orphan-${i}`, { createdAt: old });
    seedVersion("ver-a", 1, content(step("P01.1")));
    expect((await images.POST(upload({ noClientDetails: "yes" }), params({ id: "sop-1" }))).status).toBe(201);

    db.versions.length = 0;
    seedVersion("ver-a", 1, content(step("P01.1", db.images.slice(0, SCREENS_PER_SOP).map((i) => String(i.id)))));
    const full = await images.POST(upload({ noClientDetails: "yes" }), params({ id: "sop-1" }));
    expect(full.status).toBe(413);
    expect(((await full.json()) as { error: string }).error).toBe(`This SOP's versions already show ${SCREENS_PER_SOP} screens, the most one SOP can hold. An admin or partner can remove screens it no longer needs.`);
    db.images[0].removedAt = new Date();
    expect((await images.POST(upload({ noClientDetails: "yes" }), params({ id: "sop-1" }))).status).toBe(201);
  });

  it("caps screens added today and not saved in a version, with a plain sentence", async () => {
    seedSop();
    as(EDITOR);
    for (let i = 0; i < 100; i++) seedImage(`new-${i}`);
    const r = await images.POST(upload({ noClientDetails: "yes" }), params({ id: "sop-1" }));
    expect(r.status).toBe(429);
    expect(messageProblems(((await r.json()) as { error: string }).error)).toEqual([]);
  });
});

describe("H1: the image route never lets a browser keep a picture, and refuses a removed one", () => {
  it("no-store on a live picture; 410 on a removed one", async () => {
    seedSop();
    seedImage("img-1");
    seedImage("img-2", { removedAt: new Date(), bytes: new Uint8Array(0) });
    as({ id: "u-reader" });
    const live = await image.GET(new Request("https://lms.example/x"), params({ id: "sop-1", imageId: "img-1" }));
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("private, no-store");
    const gone = await image.GET(new Request("https://lms.example/x"), params({ id: "sop-1", imageId: "img-2" }));
    expect(gone.status).toBe(410);
    expect(gone.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("H1: Remove this screen", () => {
  function world() {
    seedSop();
    seedImage("img-1");
    seedVersion("ver-1", 1, content(step("P01.1", ["img-1"])), { graphItemId: "file-1", graphWebUrl: "https://onedrive.test/1", graphFiledAt: new Date(Date.now() - 60_000) });
    seedVersion("ver-2", 2, content(step("P01.1", ["img-1"])), { graphItemId: "file-2", graphWebUrl: "https://onedrive.test/2", graphFiledAt: new Date(Date.now() - 60_000) });
    seedVersion("ver-3", 3, content(step("P01.1", ["img-1"]))); // never reached OneDrive
    seedVersion("ver-4", 4, content(step("P01.1"))); // does not show it
  }
  const post = () => remove.POST(new Request("https://lms.example/x", { method: "POST" }), params({ id: "sop-1", imageId: "img-1" }));

  it("only admins and partners; an editor is refused with a plain sentence", async () => {
    world();
    as(EDITOR);
    const r = await post();
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("Only admins and partners can remove a screen. Ask one of them.");
    expect(db.images[0].removedAt).toBeNull();
  });

  it("blanks the picture (UPDATE, never a delete), re-files the filed versions, flags the one OneDrive refused, audits it all", async () => {
    world();
    as(PARTNER);
    drive.refile.mockImplementation(async ({ itemId }: { itemId: string }) => (itemId === "file-2" ? { status: "failed" } : { status: "replaced", webUrl: "https://onedrive.test/1" }));
    const r = await post();
    expect(r.status).toBe(200);
    const body = (await r.json()) as { message: string; refiled: number[]; flagged: number[] };
    expect(body).toMatchObject({ refiled: [1], flagged: [2] });
    expect(body.message).toMatch(/^The screen is removed: its picture is blanked in every version of this SOP/);
    expect(body.message).toMatch(/version 1 in OneDrive was saved again without it/);
    expect(body.message).toMatch(/version 2 in OneDrive could not be saved again and still shows the screen\. Open it in OneDrive and delete the picture by hand/);
    expect(messageProblems(body.message)).toEqual([]);

    const img = db.images[0];
    expect(img.bytes).toEqual(new Uint8Array(0));
    expect(img.removedAt).toBeInstanceOf(Date);
    expect(img.removedById).toBe("u-partner");
    expect(db.images).toHaveLength(1);
    expect(db.calls.some((c) => c.endsWith("deleteMany"))).toBe(false);
    expect(drive.refile.mock.calls.map((c) => (c[0] as { itemId: string }).itemId).sort()).toEqual(["file-1", "file-2"]);
    expect(drive.save).not.toHaveBeenCalled();

    expect(actions()).toEqual(["sop.screen-remove", "sop.onedrive-file", "sop.onedrive-file"]);
    expect(db.audits[0]).toMatchObject({ entity: "SopImage", entityId: "img-1", actorId: "u-partner", meta: { sopId: "sop-1", versions: [1, 2, 3] } });
    expect(db.audits.slice(1).map((a) => (a.meta as Row).ok)).toEqual([true, false]);

    // The SOP page keeps flagging version 2 until it is filed again; version 1 is clean.
    const removed = new Map([["img-1", img.removedAt as Date]]);
    const v = (id: string) => db.versions.find((x) => x.id === id) as { graphItemId: string | null; graphFiledAt: Date | null; content: unknown };
    expect(staleInOneDrive(v("ver-1"), removed)).toBe(false);
    expect(staleInOneDrive(v("ver-2"), removed)).toBe(true);
    expect(staleInOneDrive(v("ver-3"), removed)).toBe(false);

    // Save to OneDrive on version 2 clears it.
    drive.refile.mockResolvedValue({ status: "replaced", webUrl: "https://onedrive.test/2" });
    as(EDITOR);
    expect((await onedrive.POST(new Request("https://lms.example/x", { method: "POST" }), params({ id: "sop-1", versionId: "ver-2" }))).status).toBe(200);
    expect(staleInOneDrive(v("ver-2"), removed)).toBe(false);
  });

  it("a removed screen cannot be put back on a new version", async () => {
    world();
    db.images[0].removedAt = new Date();
    as(EDITOR);
    const r = await screens.POST(json({ baseVersionId: "ver-4", screens: { "P01.1": [{ imageId: "img-1", caption: "" }] } }), params({ id: "sop-1" }));
    expect(r.status).toBe(409);
  });
});

describe("M4: a leak-gate refusal reads as a plain sentence, never 'try again in a minute'", () => {
  const gate = () => new LegacyGateError(["BANK_AC", "PHONE"], "This procedure");
  const plain = async (r: Response) => {
    expect(r.status).toBe(422);
    const { error } = (await r.json()) as { error: string };
    expect(error).toMatch(/client details that could not be hidden from the AI/);
    expect(error).toMatch(/Remove them and try again/);
    expect(error).not.toMatch(/Try again in a minute|BANK_AC/);
    expect(messageProblems(error)).toEqual([]);
  };

  it("any LegacyGateError maps to a plain sentence; its own text is kept only when plain", () => {
    expect(failureSentence(gate(), "The SOP could not be saved.", "Try again in a minute.")).toBe("This procedure contains client details that could not be hidden from the AI (bank account number, phone number), so it was not sent. Remove them and try again, or ask an admin.");
    const coded = Object.assign(new Error("Refused (BANK_AC, VOTER_ID)"), { name: "LegacyGateError" });
    expect(failureSentence(coded, "The SOP could not be saved.", "Try again in a minute.")).toBe(LEGACY_GATE_MESSAGE);
    expect(messageProblems(LEGACY_GATE_MESSAGE)).toEqual([]);
  });

  it("analyze", async () => {
    as(EDITOR);
    ai.analyze.mockRejectedValue(gate());
    await plain(await analyze.POST(json({ title: "BRS", department: "ACCOUNTS", rawProcedure: "Match the bank statement with the ledger." })));
    expect(db.audits).toEqual([expect.objectContaining({ action: "sop.analyze", meta: expect.objectContaining({ outcome: "gate-refused" }) })]);
  });

  it("create (sops) and new version (versions)", async () => {
    as(EDITOR);
    ai.generate.mockRejectedValue(gate());
    await plain(await sops.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." })));
    seedSop();
    seedVersion("ver-a", 1, content(step("P01.1")));
    await plain(await versions.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }), params({ id: "sop-1" })));
  });
});

describe("L1: Generate is rate-limited per person and fails closed", () => {
  it("429 over the limit and 503 when the counter cannot be read; no AI call either way", async () => {
    as(EDITOR);
    db.bucket.count = 21;
    const over = await sops.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toMatch(/^You have made too many SOP generations in an hour \(the limit is 20\)\./);
    db.bucket.fail = true;
    expect((await sops.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }))).status).toBe(503);
    seedSop();
    seedVersion("ver-a", 1, content(step("P01.1")));
    expect((await versions.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }), params({ id: "sop-1" }))).status).toBe(503);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(db.bucket.keys.every((k) => k === "sop-generate:u-editor")).toBe(true);
  });
});

describe("L2 + M2: a saved SOP is never reported as failed over OneDrive; every save is audited", () => {
  it("OneDrive throwing after the save → 201 with a notice", async () => {
    as(EDITOR);
    drive.save.mockRejectedValue(new Error("socket hang up"));
    const r = await sops.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ id: db.sops[0].id, notice: ONEDRIVE_LATER });
    expect(db.versions).toHaveLength(1);
    expect(actions()).toEqual(["sop.create"]);
  });

  it("create, new version, screens save and OneDrive filing each write an AuditEvent", async () => {
    as(EDITOR);
    const created = await sops.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }));
    expect(created.status).toBe(201);
    expect(await created.json()).not.toHaveProperty("notice");
    expect(actions()).toEqual(["sop.create", "sop.onedrive-file"]);
    const sopId = String(db.sops[0].id);

    db.audits.length = 0;
    const edited = await versions.POST(json({ brief, rawProcedure: "Match the bank statement with the ledger." }), params({ id: sopId }));
    expect(edited.status).toBe(201);
    expect(actions()).toEqual(["sop.version-create", "sop.onedrive-file"]);

    db.audits.length = 0;
    const latest = db.versions.find((v) => v.versionNumber === 2)!;
    db.images.push({ id: "img-s", sopId, mime: "image/png", bytes: PNG, width: 1, height: 1, createdById: "u-editor", createdAt: new Date(), removedAt: null });
    const saved = await screens.POST(json({ baseVersionId: latest.id, screens: { "P01.1": [{ imageId: "img-s", caption: "Ledger" }] } }), params({ id: sopId }));
    expect(saved.status).toBe(201);
    expect(actions()).toEqual(["sop.screens-save", "sop.onedrive-file"]);
    expect(db.audits[0]).toMatchObject({ entity: "SopVersion", actorId: "u-editor", meta: expect.objectContaining({ sopId, versionNumber: 3, screens: 1 }) });
  });
});

describe("L3 + L5: body cap and folder names", () => {
  it("the middleware lets a 3 MB screenshot through to the route, whose own limit is 3 MB", () => {
    const r = { method: "POST", pathname: "/api/tools/sop-builder/sops/sop-1/images", hasSession: true, hasBearer: false };
    expect(bodyLimitFor(r)).toBe(SCREEN_MAX_BYTES + MULTIPART_FRAMING_BYTES);
    expect(checkBody({ ...r, contentLength: String(Math.round(2.5 * 1024 * 1024)), transferEncoding: null })).toEqual({ ok: true, limit: SCREEN_MAX_BYTES + MULTIPART_FRAMING_BYTES });
    expect(checkBody({ ...r, contentLength: String(SCREEN_MAX_BYTES + MULTIPART_FRAMING_BYTES + 1), transferEncoding: null }).ok).toBe(false);
  });

  it("a folder name never ends in a dot or a space, even after the cut to 80", () => {
    expect(sanitize(`${"a".repeat(78)} .and more`)).toBe("a".repeat(78));
    expect(sanitize("Bank reconciliation. ")).toBe("Bank reconciliation");
    expect(sanitize("Proc: GST/TDS?")).toBe("Proc- GST-TDS-");
    expect(sanitize(" .. ")).toBe("SOP");
  });
});

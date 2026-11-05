// Comms drafts service over an in-memory world: access scoped as /agents is, every create stored
// with an AuditEvent (no message text), the list / view / draft panel, and "Open in Outlook draft"
// (a draft in the person's own mailbox; never a send).
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommsWorld, type MemClient, type MemJob } from "../../../../tests/fakes/comms-world";
import { scriptedRouter } from "../../../../tests/fakes/comms-router";
import { COMMS_AUDIT, createDraft, listClientOptions, listDrafts, loadDraft, loadDraftContext, openInOutlook, type OutlookPort } from "./service";
import { ENGLISH_DIVIDER } from "./compose";

const person = (id: string, over: Partial<Session["user"]> = {}): Session["user"] => ({ id, name: id, email: `${id}@indefine.test`, image: null, role: "EMPLOYEE", active: true, department: "ACCOUNTS", level: "EXECUTIVE", ...over }) as Session["user"];
const priya = person("u-priya", { name: "Priya Sharma" });
const other = person("u-other");
const manager = person("u-mgr", { level: "MANAGER" });
const NOW = new Date("2026-11-05T06:00:00Z");

const offline = () => ({ router: scriptedRouter([], { available: false }).router, now: NOW });
const keep = (_r: unknown, i: Record<string, unknown>) => ({ status: "polished", subject: i.subject, paragraphs: i.paragraphs });

let w: CommsWorld;
let acme: MemClient;
let job: MemJob;
beforeEach(() => {
  w = new CommsWorld();
  acme = w.addClient();
  job = w.addJob(acme);
});

describe("createDraft", () => {
  it("status update for a job the person prepares: stored as a CommsDraft, audited without the text", async () => {
    const r = scriptedRouter([keep]);
    const res = await createDraft(w.db, priya, { kind: "status", jobId: job.id }, { router: r.router, now: NOW });
    expect(res).toEqual({ ok: true, data: { id: w.drafts[0].id, href: `/comms/${w.drafts[0].id}` } });
    expect(w.drafts[0]).toMatchObject({ firmClientId: acme.id, jobTaskId: job.id, kind: "status", language: "en", createdById: "u-priya", outlookDraftId: null });
    expect(w.drafts[0].subject).toBe("GSTR-3B for October 2026 (Acme Traders Private Limited): status update");
    expect(w.drafts[0].body).toContain("The due date for filing is 20 Nov 2026.");
    expect(w.drafts[0].body.endsWith("Regards,\nPriya Sharma\nIndefine")).toBe(true);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ actorId: "u-priya", action: COMMS_AUDIT.create, entity: "CommsDraft", entityId: w.drafts[0].id });
    expect(w.audits[0].meta).toMatchObject({ kind: "status", language: "en", department: "GST", wording: "model", translation: "none", modelCalls: 1, identifiers: 0 });
    expect(JSON.stringify(w.audits[0].meta)).not.toMatch(/Acme|Ravi|due date/);
    expect(r.rows[0].runId).toMatch(/^comms:[0-9a-f-]{36}$/);
  });

  it("the client's preferred language is the default; without a model the draft stays English and says so", async () => {
    acme.preferredLanguage = "kn";
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    expect(w.drafts[0].language).toBe("en");
    expect(w.audits[0].meta).toMatchObject({ requestedLanguage: "kn", translation: "failed", wording: "template" });
    expect((w.audits[0].meta as { notes: string[] }).notes).toEqual([
      "Template wording: the drafting model is not available (no model key is configured, or the provider is down).",
      "No translation: the drafting model is not available (no model key is configured, or the provider is down). The English is used on its own.",
    ]);
  });

  it("doc-chase from an agent run: the run's job, the run id in the audit", async () => {
    w.runs.push({ id: "run-1", agent: "tax", jobTaskId: job.id, checklist: [] });
    const res = await createDraft(w.db, priya, { kind: "doc-chase", runId: "run-1", items: ["Form 26AS"], replyBy: "2026-11-10" }, offline());
    expect(res.ok).toBe(true);
    expect(w.drafts[0].body).toContain("- Form 26AS");
    expect(w.drafts[0].body).toContain("Please send them by 10 Nov 2026.");
    expect(w.audits[0].meta).toMatchObject({ agentRunId: "run-1", jobTaskId: job.id });
  });

  it("due reminder and filing-completed use the job's recorded facts", async () => {
    expect((await createDraft(w.db, priya, { kind: "due-reminder", jobId: job.id, ask: "payment", amountInr: 123456, replyBy: "2026-11-18" }, offline())).ok).toBe(true);
    expect(w.drafts[0].body).toContain("Please arrange the payment of ₹1,23,456.00 by 18 Nov 2026.");
    const filed = w.addJob(acme, { title: "GSTR-1", state: "FILED_BY_HUMAN", filedAt: new Date("2026-11-11T09:00:00Z"), ackRef: "AA2911260123456" });
    expect((await createDraft(w.db, priya, { kind: "filing-completed", jobId: filed.id }, offline())).ok).toBe(true);
    expect(w.drafts[1].body).toContain("The acknowledgement number is AA2911260123456.");
  });

  it("access: 403 for staff not on the job or client, managers may draft for any client", async () => {
    expect(await createDraft(w.db, other, { kind: "status", jobId: job.id }, offline())).toMatchObject({ ok: false, status: 403 });
    expect(await createDraft(w.db, other, { kind: "query-response", clientCode: "ACME01", department: "GST", topic: "Rent", answer: "Yes." }, offline())).toMatchObject({ ok: false, status: 403 });
    expect(await createDraft(w.db, person("u-x", { active: false }), { kind: "status", jobId: job.id }, offline())).toMatchObject({ ok: false, status: 403 });
    expect((await createDraft(w.db, manager, { kind: "status", jobId: job.id }, offline())).ok).toBe(true);
    expect((await createDraft(w.db, priya, { kind: "query-response", clientCode: "ACME01", department: "IncomeTax", topic: "advance tax", answer: "The next instalment is due on 15 Dec 2026." }, offline())).ok).toBe(true);
    expect(w.drafts[1]).toMatchObject({ jobTaskId: null, kind: "query-response" });
  });

  it("404 for an unknown job, run or client", async () => {
    expect(await createDraft(w.db, priya, { kind: "status", jobId: "nope" }, offline())).toMatchObject({ ok: false, status: 404, error: "Job not found" });
    expect(await createDraft(w.db, priya, { kind: "status", runId: "nope" }, offline())).toMatchObject({ ok: false, status: 404, error: "Agent run not found" });
    expect(await createDraft(w.db, priya, { kind: "query-response", clientCode: "NOPE01", department: "GST", topic: "x", answer: "y" }, offline())).toMatchObject({ ok: false, status: 404 });
  });

  it("400 for bad input, 409 when a fact is not recorded yet; nothing is stored", async () => {
    const bad = [
      [{ kind: "letter" }, /Pick what the message is for/],
      [{ kind: "status" }, /Pick the job/],
      [{ kind: "query-response", topic: "x", answer: "y" }, /Pick the client/],
      [{ kind: "query-response", clientCode: "ACME01", topic: "x", answer: "y" }, /department/],
      [{ kind: "status", jobId: job.id, clientCode: "OTHER1" }, /another client/],
      [{ kind: "doc-chase", jobId: job.id, items: ["A"] }, /reply by/],
      [{ kind: "doc-chase", jobId: job.id, items: ["A"], replyBy: "2026-11-01" }, /in the past/],
      [{ kind: "due-reminder", jobId: job.id, ask: "confirm", replyBy: "2026-11-25" }, /after the due date/],
      [{ kind: "due-reminder", jobId: job.id, replyBy: "2026-11-10" }, /what the reminder asks/],
      [{ kind: "doc-chase", jobId: job.id, items: [], replyBy: "2026-11-10" }, /at least one/],
      [{ kind: "status", jobId: job.id, amountInr: -1 }, /above/],
    ] as const;
    for (const [body, msg] of bad) {
      const r = await createDraft(w.db, priya, body, offline());
      expect(r, JSON.stringify(body)).toMatchObject({ ok: false, status: 400 });
      expect((r as { error: string }).error).toMatch(msg);
    }
    w.runs.push({ id: "run-1", agent: "gst", jobTaskId: job.id, checklist: [] });
    expect(await createDraft(w.db, priya, { kind: "status", runId: "run-1", jobId: "jt-other" }, offline())).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(w.db, priya, { kind: "filing-completed", jobId: job.id }, offline())).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Mark filed/) });
    expect(w.drafts).toEqual([]);
    expect(w.audits).toEqual([]);
  });
});

describe("list, view and the draft panel", () => {
  async function seed() {
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    const beta = w.addClient({ clientCode: "BETA02", client: { name: "Beta Foods LLP", contactName: null, contactEmail: null } });
    const betaJob = w.addJob(beta, { assigneeId: "u-mgr", reviewerId: null });
    await createDraft(w.db, manager, { kind: "status", jobId: betaJob.id }, offline());
    return { beta, betaJob };
  }

  it("staff see drafts on their jobs (and their own); managers see all; filters by client and job", async () => {
    const { betaJob } = await seed();
    expect((await listDrafts(w.db, priya)).map((r) => r.clientCode)).toEqual(["ACME01"]);
    expect(await listDrafts(w.db, other)).toEqual([]);
    expect((await listDrafts(w.db, manager)).map((r) => r.clientCode)).toEqual(["BETA02", "ACME01"]);
    expect((await listDrafts(w.db, manager, { client: "ACME01" })).map((r) => r.clientCode)).toEqual(["ACME01"]);
    expect((await listDrafts(w.db, manager, { job: betaJob.id })).map((r) => r.clientCode)).toEqual(["BETA02"]);
    expect(await listDrafts(w.db, manager, { client: "NOPE01" })).toEqual([]);
    expect(await listDrafts(w.db, null)).toEqual([]);
    const [row] = await listDrafts(w.db, priya);
    expect(row).toMatchObject({ kind: "Status update", language: "English", job: "GSTR-3B · October 2026", inOutlook: false, by: "Priya Sharma", clientName: "Acme Traders Private Limited" });
    expect(row.createdAt).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/);
  });

  it("loadDraft: the text, the English part of a bilingual draft, the staff notes; 403 / 404", async () => {
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    const d = w.drafts[0];
    const v = await loadDraft(w.db, priya, d.id);
    expect(v).toMatchObject({ ok: true, data: { kind: "Status update", language: "en", translated: null, client: { code: "ACME01", contactEmail: "ravi@acme.test" }, job: { id: job.id }, inOutlook: false, by: "Priya Sharma" } });
    expect((v as { data: { notes: string[] } }).data.notes[0]).toMatch(/^Template wording/);
    d.language = "kn";
    d.body = `ಕನ್ನಡ\n\n${ENGLISH_DIVIDER}\n\nEnglish`;
    expect(await loadDraft(w.db, priya, d.id)).toMatchObject({ ok: true, data: { languageLabel: "Kannada", translated: "ಕನ್ನಡ", english: "English" } });
    expect(await loadDraft(w.db, other, d.id)).toMatchObject({ ok: false, status: 403 });
    expect(await loadDraft(w.db, priya, "nope")).toMatchObject({ ok: false, status: 404 });
    expect(await loadDraft(w.db, null, d.id)).toMatchObject({ ok: false, status: 403 });
  });

  it("a client-level draft (no job) opens only for its author, the client's primary handler and managers — not for staff on the client's other jobs", async () => {
    acme.client.primaryHandlerId = "u-handler";
    const handler = person("u-handler");
    await createDraft(w.db, manager, { kind: "query-response", clientCode: "ACME01", department: "GST", topic: "rent", answer: "Yes, it applies." }, offline());
    const id = w.drafts[0].id;
    expect(w.drafts[0].jobTaskId).toBeNull();
    expect((await loadDraft(w.db, manager, id)).ok).toBe(true); // author (and a manager)
    expect((await loadDraft(w.db, handler, id)).ok).toBe(true); // the client's primary handler
    expect(await loadDraft(w.db, priya, id)).toMatchObject({ ok: false, status: 403 }); // assignee of another job of the client
    expect(await loadDraft(w.db, other, id)).toMatchObject({ ok: false, status: 403 });
    // The /comms list follows the same rule.
    expect((await listDrafts(w.db, handler)).map((r) => r.id)).toEqual([id]);
    expect(await listDrafts(w.db, priya)).toEqual([]);
    // Outlook needs the same access as opening the draft.
    const outlook: OutlookPort = { create: vi.fn(), find: vi.fn() };
    expect(await openInOutlook(w.db, priya, id, { token: async () => "t", outlook })).toMatchObject({ ok: false, status: 403 });
    expect(outlook.create).not.toHaveBeenCalled();
  });

  it("a client-level draft by staff stays with them when the client has no primary handler match", async () => {
    await createDraft(w.db, priya, { kind: "query-response", clientCode: "ACME01", department: "GST", topic: "rent", answer: "Yes, it applies." }, offline());
    const id = w.drafts[0].id;
    expect((await loadDraft(w.db, priya, id)).ok).toBe(true);
    expect(await loadDraft(w.db, person("u-ravi"), id)).toMatchObject({ ok: false, status: 403 }); // reviewer of the job, not the client's handler
  });

  it("loadDraftContext from a run: the run's job, document suggestions, defaults", async () => {
    w.runs.push({ id: "run-1", agent: "tax", jobTaskId: job.id, checklist: [{ ruleId: "tax.missing-docs", status: "fail", message: "Ask the client / staff for: Form 26AS; Prior-year ITR", evidence: null }] });
    const r = await loadDraftContext(w.db, priya, { run: "run-1" }, NOW);
    expect(r).toMatchObject({
      ok: true,
      data: {
        client: { code: "ACME01", preferredLanguage: "en", contactEmail: "ravi@acme.test" },
        job: { id: job.id, label: "GSTR-3B · October 2026", due: "2026-11-20", filed: false },
        run: { id: "run-1", agent: "tax" },
        suggestions: ["Form 26AS", "Prior-year ITR"],
        defaults: { replyBy: "2026-11-08", kind: "doc-chase" },
      },
    });
    expect((await loadDraftContext(w.db, priya, { job: job.id }, NOW)).ok).toBe(true);
    expect(await loadDraftContext(w.db, priya, { client: "ACME01" }, NOW)).toMatchObject({ ok: true, data: { job: null, defaults: { kind: "query-response" } } });
    expect(await loadDraftContext(w.db, priya, {}, NOW)).toEqual({ ok: true, data: null });
    expect(await loadDraftContext(w.db, priya, { run: "nope" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await loadDraftContext(w.db, priya, { job: "nope" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await loadDraftContext(w.db, priya, { client: "NOPE01" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await loadDraftContext(w.db, other, { job: job.id }, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await loadDraftContext(w.db, other, { client: "ACME01" }, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await loadDraftContext(w.db, null, {}, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("listClientOptions: clients the person may draft for", async () => {
    await seed();
    expect(await listClientOptions(w.db, priya)).toEqual([{ code: "ACME01", name: "Acme Traders Private Limited" }]);
    expect((await listClientOptions(w.db, manager)).map((c) => c.code)).toEqual(["ACME01", "BETA02"]);
    expect(await listClientOptions(w.db, null)).toEqual([]);
  });
});

describe("openInOutlook", () => {
  function port(over: Partial<OutlookPort> = {}) {
    const create = vi.fn<OutlookPort["create"]>(async () => ({ id: "AAMk-1", webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-1" }));
    const find = vi.fn<OutlookPort["find"]>(async () => ({ id: "AAMk-1", isDraft: true, webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-1" }));
    return { create, find, ...over } as OutlookPort & { create: typeof create; find: typeof find };
  }
  const token = (t: string | null) => async () => t;

  it("no mailbox connected: 412 with the connect link, nothing created", async () => {
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    const p = port();
    expect(await openInOutlook(w.db, priya, w.drafts[0].id, { token: token(null), outlook: p })).toEqual({ ok: false, status: 412, error: expect.stringMatching(/Connect your Microsoft 365 mailbox/), connect: "/connect?mail=1" });
    expect(p.create).not.toHaveBeenCalled();
  });

  it("creates the draft in the person's mailbox (client contact as recipient), then finds it again", async () => {
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    const d = w.drafts[0];
    const p = port();
    expect(await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: p })).toEqual({ ok: true, data: { webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-1", created: true } });
    expect(p.create).toHaveBeenCalledWith("tok", { to: ["ravi@acme.test"], subject: d.subject, body: d.body, bodyType: "Text" });
    expect(d.outlookDraftId).toBe("AAMk-1");
    expect(w.audits.at(-1)).toMatchObject({ action: COMMS_AUDIT.outlook, entityId: d.id, meta: { created: true, recipients: 1 } });

    expect(await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: p })).toMatchObject({ ok: true, data: { created: false } });
    expect(p.create).toHaveBeenCalledTimes(1);

    const gone = port({ find: vi.fn(async () => null) });
    expect(await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: gone })).toMatchObject({ ok: true, data: { created: true } });
  });

  it("no contact e-mail: an empty recipient list; Graph refusals become 412 / 502; access first", async () => {
    acme.client.contactEmail = "not an email";
    await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline());
    const d = w.drafts[0];
    const p = port();
    await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: p });
    expect(p.create.mock.calls[0][1].to).toEqual([]);
    d.outlookDraftId = null;
    const forbidden = port({ create: vi.fn(async () => Promise.reject(Object.assign(new Error("Graph 403"), { status: 403 }))) });
    expect(await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: forbidden })).toMatchObject({ ok: false, status: 412, connect: "/connect?mail=1" });
    const down = port({ create: vi.fn(async () => Promise.reject(new Error("Graph 503"))) });
    expect(await openInOutlook(w.db, priya, d.id, { token: token("tok"), outlook: down })).toMatchObject({ ok: false, status: 502 });
    const tokenSpy = vi.fn(async () => "tok");
    expect(await openInOutlook(w.db, other, d.id, { token: tokenSpy, outlook: p })).toMatchObject({ ok: false, status: 403 });
    expect(await openInOutlook(w.db, priya, "nope", { token: tokenSpy, outlook: p })).toMatchObject({ ok: false, status: 404 });
    expect(tokenSpy).not.toHaveBeenCalled();
  });

  it("the Outlook port has no send method", () => {
    expect(Object.keys(port()).sort()).toEqual(["create", "find"]);
  });
});

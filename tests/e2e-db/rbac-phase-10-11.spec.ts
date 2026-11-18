// Written ahead of Phases 10 and 11 against the orchestrator's brief and the owner decisions of
// 2026-11-05; routes and labels confirmed against the merged code on 06 Nov 2026 (comms: src/app/comms,
// /api/firm-os/comms/drafts/[id]/outlook; spot checks: src/app/agents/spot-checks,
// /api/firm-os/spot-checks/[id], canSpotCheck; mistakes: canDecideMistakes = partner only).
//
// Golden path (g), the rest of it:
//   · a staff member cannot open a comms draft on someone else's job (page 404; Outlook route 404) [10]
//   · only a partner opens /agents/spot-checks (owner: partners perform the 10% Turia spot
//     checks); staff and managers are sent away and cannot record a spot check                 [11]
//   · only a partner decides a proposed SOP rule (Phase 11: "only partner can approve SOP rule
//     changes"); a manager gets 403; the partner's decision (reject — no pack change) lands     [11]
//
// Runs under `npm run e2e:db` (--repeat-each=3). Environment: E2E_BASE_URL, DATABASE_URL,
// E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL, E2E_OTHER_STAFF_STATE, E2E_MANAGER_STATE, E2E_PARTNER_STATE,
// E2E_REVIEWER_EMAIL, E2E_CLIENT_CODE.
import { expect, test } from "@playwright/test";
import { closeDb, e2eClient, freshJob, openDb, runTag, signedInAll, userByEmail } from "./support";

const SPEC = "rbac-phase-10-11.spec.ts";
const SPOT_CHECKS = "/agents/spot-checks";
const SPOT_CHECK_API = (syncId: string) => `/api/firm-os/spot-checks/${syncId}`;
const DRAFT_PAGE = (id: string) => `/comms/${id}`;
const DRAFT_OUTLOOK = (id: string) => `/api/firm-os/comms/drafts/${id}/outlook`;

test.afterAll(closeDb);

test("another staff member cannot open a comms draft on someone else's job", { tag: ["@phase-10"] }, async ({ browser }) => {
  // A draft on a job is visible to its creator, the job's assignee / reviewer, managers and partners;
  // a draft without a job to anyone who works on the client — so the probe draft is tied to a job.
  const db = openDb();
  const fc = await e2eClient(db, SPEC);
  const owner = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  const job = await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B comms-rbac", spec: SPEC });
  const draft = await db.commsDraft.create({
    data: { firmClientId: fc.id, jobTaskId: job.id, kind: "doc-chase", subject: `E2E draft ${runTag()}`, body: "Please share the October purchase register.", createdById: owner.id },
  });
  const s = await signedInAll(browser, ["assignee", "other"] as const, SPEC);
  try {
    expect((await s.assignee.page.goto(DRAFT_PAGE(draft.id)))?.status()).toBe(200); // control
    expect((await s.other.page.goto(DRAFT_PAGE(draft.id)))?.status()).toBe(404);
    expect([403, 404]).toContain((await s.other.post(DRAFT_OUTLOOK(draft.id), {})).status());
    expect((await db.commsDraft.findUniqueOrThrow({ where: { id: draft.id } })).outlookDraftId).toBeNull();
  } finally {
    await s.closeAll();
  }
});

test("only a partner opens Turia spot checks and records one; staff and managers can do neither", { tag: ["@phase-11"] }, async ({ browser }) => {
  const db = openDb();
  const job = await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B spot-check", spec: SPEC });
  const sync = await db.turiaSync.create({
    data: { jobTaskId: job.id, operation: "closeTask", mode: "MANUAL", status: "CLOSED", turiaRef: `TT-${runTag()}`, minutesLogged: 40, evidence: { key: `closeTask:${job.id}` } },
  });
  // As the close gate does for ~10% of manual Turia closes (src/lib/audit/spot-checks.ts SPOT_CHECK_SELECTED).
  await db.auditEvent.create({ data: { actorId: "system:close-gate", action: "spot-check-selected", entity: "TuriaSync", entityId: sync.id, meta: { jobTaskId: job.id } } });
  const s = await signedInAll(browser, ["other", "manager", "partner"] as const, SPEC);
  try {
    for (const who of [s.other, s.manager]) {
      const r = await who.get(SPOT_CHECKS);
      expect([302, 303, 307, 308], `${who.role} is sent away from ${SPOT_CHECKS}`).toContain(r.status());
      expect(new URL(r.headers()["location"] ?? "", "http://x").pathname).toBe("/agents");
      expect((await who.post(SPOT_CHECK_API(sync.id), { note: "not allowed" })).status(), `${who.role} cannot record a spot check`).toBe(403);
    }
    expect((await db.turiaSync.findUniqueOrThrow({ where: { id: sync.id } })).spotChecked).toBe(false);

    const page = await s.partner.page.goto(SPOT_CHECKS);
    expect(page?.status()).toBe(200);
    await expect(s.partner.page.getByRole("heading", { level: 1, name: "Turia spot checks" })).toBeVisible();
    expect((await s.partner.post(SPOT_CHECK_API(sync.id), { note: "Checked in Turia: time entry matches" })).status()).toBe(200);
    expect(await db.turiaSync.findUniqueOrThrow({ where: { id: sync.id } })).toMatchObject({ spotChecked: true, spotCheckNote: "Checked in Turia: time entry matches" });
    expect(await db.auditEvent.count({ where: { action: "spot-check", entity: "TuriaSync", entityId: sync.id } })).toBe(1);
  } finally {
    await s.closeAll();
  }
});

test("only a partner decides a proposed SOP rule: manager 403, partner's reject recorded", { tag: ["@phase-11"] }, async ({ browser }) => {
  const db = openDb();
  const reviewer = await userByEmail(db, "E2E_REVIEWER_EMAIL", SPEC);
  const proposal = await db.mistakeLog.create({
    data: {
      agent: "gst",
      pattern: "e2e partner-only decision probe",
      ruleProposal: { id: `gst.e2e-partner-${runTag().toLowerCase()}`, title: "E2E partner-only probe", severity: "warn", kind: "llm", check: "Is there an e2e probe marker?", evidence: "row of the register" },
      createdById: reviewer.id,
    },
  });
  const s = await signedInAll(browser, ["manager", "partner"] as const, SPEC);
  try {
    expect((await s.manager.post(`/api/firm-os/agents/mistakes/${proposal.id}/decide`, { decision: "approve" })).status()).toBe(403);
    expect((await db.mistakeLog.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PROPOSED");
    // Reject, never approve, on staging: approving would publish a new GST SOP pack version.
    expect((await s.partner.post(`/api/firm-os/agents/mistakes/${proposal.id}/decide`, { decision: "reject" })).status()).toBe(200);
    expect((await db.mistakeLog.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("REJECTED");
  } finally {
    await s.closeAll();
  }
});

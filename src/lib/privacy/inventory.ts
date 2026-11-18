// Personal data Firm OS and the LMS client master hold about one data principal, as data: which
// table, which fields (ADR-006 class A client data / B staff data / C firm data), why it is held,
// and what erasure does to it. Two lists:
//
//   DATASETS          the person's records. The access export and the erasure plan both walk it,
//                     so a field added here is exported and planned for in one place.
//   RESIDUE_DATASETS  copies of the person's identifiers inside free text and JSON of work records
//                     (audit comments and notes, agent figures and findings, transition notes,
//                     Turia checklists, mistake examples, nudges, model errors, onboarding runs that
//                     never reached a client record, privacy-request notes, deliverable names).
//                     Only the erasure plan walks it: the identifiers are replaced in place with
//                     "[erased]" (scrub.ts) and every other value, row id and JSON key stays. Not
//                     exported, because these rows also hold staff notes and other parties' data.
//
// Built from ADR-006, docs/dpdp/data-inventory.md and prisma/schema.prisma; the two documents and
// this file change together.
//
// Deliberately left out of the export: AgentRun inputs and figures (cached registers and
// computations that also name the client's customers and suppliers — other people's data), staff
// ids on client records (staff data, ADR-006 class B), and anything matched only by a shared name.
//
// The Turia pull's copy of Turia's task list (ADR-003 Amendment 1) is walked like the rest:
// TuriaTaskMirror and TuriaClientLink for a client (found by the client's links, or by the code
// and normalised name the pull matches on, src/lib/integrations/turia/pull/match.ts), TuriaPersonLink
// and the mirror's assignee / reviewer lists for staff, and the run reports (TuriaPullRun.preview).
// An erased client's link and mirror rows get an erased key (pull/erased.ts) that the pull
// recognises, so the next run neither copies them back from Turia nor maps the client again.
import { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { ERASED_CLIENT_NOTE, ERASED_PERSON, erasedClientKey, isErasedKey } from "@/lib/integrations/turia/pull/erased";
import { normName } from "@/lib/integrations/turia/pull/normalise";
import type { DutyId, PrincipalType } from "./policy";
import { ERASED_TOKEN, WITHHELD_THIRD_PARTY, clientNeedles, codeNeedle, namePartNeedles, panNeedle, phoneNeedle, phraseNeedle, scrubColumns, scrubberFor, type Needle, type Scrubber } from "./scrub";

export type Row = Record<string, unknown>;

export type PrivacyDb = Pick<
  typeof prisma,
  | "client"
  | "firmClient"
  | "jobTask"
  | "jobTaskEvent"
  | "job"
  | "engagement"
  | "commsDraft"
  | "onboardingRun"
  | "agentRun"
  | "checklistResult"
  | "mistakeLog"
  | "deliverable"
  | "turiaSync"
  | "coachEvent"
  | "modelCall"
  | "clientDocument"
  | "certificateIssue"
  | "engagementLetter"
  | "user"
  | "attendanceRecord"
  | "coachPreference"
  | "activityHeartbeat"
  | "auditEvent"
  | "privacyRequest"
  | "breachIncident"
  | "turiaTaskMirror"
  | "turiaClientLink"
  | "turiaPersonLink"
  | "turiaPullRun"
  | "sopVersion"
  | "sopImage"
  | "$transaction"
>;

export type ModelName = Exclude<keyof PrivacyDb, "$transaction">;
/** The tables without $transaction: what reads need, so they also run inside a transaction. */
export type PrivacyReadDb = Pick<PrivacyDb, ModelName>;

/** Everything about one client principal that the datasets read from. */
export interface ClientScope {
  kind: "client";
  principalType: Exclude<PrincipalType, "staff">;
  client: Row;
  firmClient: Row | null;
  jobTasks: Row[];
  jobs: Row[];
  engagements: Row[];
  /** The Turia pull's view of this client (client persons only; empty for a company's contact). */
  turia: TuriaClientRefs;
  /** Key of the erased Turia keys (pull/erased.ts); undefined: AUTH_SECRET, as the pull uses. */
  hashKey?: string;
}

/**
 * The Turia client keys (TuriaClientLink.key = TuriaTaskMirror.clientKey) that are this client's:
 * the links an admin or the pull pointed at the client record, and the keys the pull would match to
 * it (its FirmClient code, or its normalised name when no other client has that name), unless a link
 * points that key at another client or an admin set it to ignore. `names`: how Turia spells the
 * client, as found in those links and mirror rows (needles for its names in the run reports).
 */
export interface TuriaClientRefs {
  keys: string[];
  names: string[];
}

export interface StaffScope {
  kind: "staff";
  user: Row;
  /** The person's Turia users (TuriaPersonLink rows pointing at the user). */
  turia: TuriaStaffRefs;
  hashKey?: string;
}

/**
 * `ids`: Turia user ids linked to the user. `names` / `emails`: how Turia names them, kept only when
 * no other person's link has the same name. `nameShared`: another user has the same LMS name, so
 * the name alone is not used to find or clean anything.
 */
export interface TuriaStaffRefs {
  ids: string[];
  names: string[];
  emails: string[];
  nameShared: boolean;
}

export type Scope = ClientScope | StaffScope;

export interface DataField {
  name: string;
  label: string;
  /** ADR-006 data class. */
  cls: "A" | "B" | "C";
}

/**
 * anonymise  UPDATE the listed columns in place (row ids and financial figures stay) — unless a
 *            retention duty applies, then a legal hold is placed instead.
 * hold       always held (SharePoint files, which Firm OS never removes); the hold date comes
 *            from the duties.
 * keep       not personal data on its own, or already purged on a schedule; nothing to do.
 */
export type ErasureRule =
  | {
      kind: "anonymise";
      /** Duties that put the item on legal hold instead: every duty in force ("client"), or only these. */
      duties: "client" | readonly DutyId[];
      /** A sentence added to the plan's consequence (what else the UPDATE does). */
      note?: string;
      /** Column values the UPDATE writes. `s` replaces the person's identifiers in text and JSON. */
      set: (row: Row, s: Scrubber, scope: Scope) => Row;
      applies?: (row: Row, s: Scrubber, scope: Scope) => boolean;
    }
  | { kind: "hold"; duties: "client"; reason: string }
  | { kind: "keep"; reason: string };

export interface DataSet {
  key: string;
  label: string;
  model: ModelName;
  principals: readonly PrincipalType[];
  purpose: string;
  fields: readonly DataField[];
  /** Fields computed for the export instead of read raw (e.g. "inputs cached: yes"). */
  derived?: (row: Row, scope: Scope) => Row;
  erasure: ErasureRule;
  rows(db: PrivacyReadDb, scope: Scope): Promise<Row[]>;
  /** The UPDATE's `where` for a table whose key is not `id` (rows carry an `id` alias for the plan). */
  where?: (row: Row) => Row;
}

type Finder = { findMany(args: { where: Row; select?: Row; orderBy?: Row; take?: number }): Promise<Row[]> };
const finder = (db: PrivacyReadDb, model: ModelName) => db[model] as unknown as Finder;

const ERASED = ERASED_TOKEN;
const erasedJson = { erased: true } as const;
const CLIENT_PEOPLE: readonly PrincipalType[] = ["client-person"];
const CLIENT_ANY: readonly PrincipalType[] = ["client-person", "client-contact"];
const STAFF: readonly PrincipalType[] = ["staff"];
const TURIA_SKIP_NOTE = "The Turia pull skips these tasks from now on, so they are not copied back from Turia; erase or anonymise the client in Turia too.";

const f = (name: string, label: string, cls: DataField["cls"] = "A"): DataField => ({ name, label, cls });
/** A value that is not already erased ("[erased] …", "erased+…@erased.invalid"). */
export const liveText = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t && !t.startsWith(ERASED_TOKEN) && !t.endsWith("@erased.invalid") ? t : null;
};
const ids = (rows: Row[]) => rows.map((r) => String(r.id));
const clientOf = (s: Scope) => (s.kind === "client" ? s : null);
const staffOf = (s: Scope) => (s.kind === "staff" ? s : null);

export const DATASETS: readonly DataSet[] = [
  {
    key: "client-identity",
    label: "Client master (LMS /clients)",
    model: "client",
    principals: CLIENT_PEOPLE,
    purpose: "Identify the client and carry out the engagement (KYC, returns, filings).",
    fields: [
      f("name", "Name"),
      f("entityType", "Entity type", "C"),
      f("pan", "PAN"),
      f("gstin", "GSTIN"),
      f("cin", "CIN / LLPIN", "C"),
      // A (may): with the name and city, an individual's trade identifies them; erasure clears it.
      f("industry", "Industry"),
      f("city", "City"),
      f("turnover", "Turnover (₹)", "C"),
      f("growthGoal", "Growth goal", "C"),
      f("growthNote", "Growth note"),
      f("referralSource", "Referral source"),
      f("onboardedOn", "Onboarded on", "C"),
      f("active", "Active client", "C"),
    ],
    erasure: {
      kind: "anonymise",
      duties: "client",
      // Keeps the row id, entity type, turnover and dates (financial integrity). The folder name
      // mirrors a SharePoint folder Firm OS never renames, so it changes only when no folder exists.
      set: (r) => ({
        name: `${ERASED} ${String(r.id)}`,
        pan: null,
        gstin: null,
        cin: null,
        industry: null,
        city: null,
        growthNote: null,
        referralSource: null,
        active: false,
        ...(!r.graphFolderId && r.folderStatus !== "READY" ? { folderName: `${ERASED} ${String(r.id)}` } : {}),
      }),
    },
    rows: async (_db, s) => (clientOf(s) ? [clientOf(s)!.client] : []),
  },
  {
    key: "client-contact",
    label: "Client contact details (LMS /clients)",
    model: "client",
    principals: CLIENT_ANY,
    purpose: "Contact the client about the engagement.",
    fields: [f("contactName", "Contact name"), f("contactPhone", "Contact phone"), f("contactEmail", "Contact email")],
    erasure: { kind: "anonymise", duties: ["active-engagement"], set: () => ({ contactName: null, contactPhone: null, contactEmail: null }) },
    rows: async (_db, s) => (clientOf(s) ? [clientOf(s)!.client] : []),
  },
  {
    key: "firm-client",
    label: "Firm OS client link",
    model: "firmClient",
    principals: CLIENT_PEOPLE,
    purpose: "Link the client to its SharePoint site and Turia record; choose the language of message drafts.",
    fields: [f("clientCode", "Client code", "C"), f("turiaClientRef", "Turia reference", "C"), f("clSiteUrl", "SharePoint site", "C"), f("preferredLanguage", "Preferred language")],
    erasure: { kind: "keep", reason: "Codes and links that keep held records findable; they identify the client file, not personal details." },
    rows: async (_db, s) => (clientOf(s)?.firmClient ? [clientOf(s)!.firmClient!] : []),
  },
  {
    key: "engagements",
    label: "Services engaged (Firm OS)",
    model: "engagement",
    principals: CLIENT_PEOPLE,
    purpose: "Plan the recurring work the client engaged the firm for.",
    fields: [f("service", "Service", "C"), f("frequency", "Frequency", "C"), f("firstPeriod", "First period", "C"), f("active", "Active", "C")],
    erasure: { kind: "keep", reason: "Which services the firm provides; no personal data beyond the link to the client." },
    rows: async (_db, s) => clientOf(s)?.engagements ?? [],
  },
  {
    key: "job-tasks",
    label: "Jobs and filings (Firm OS)",
    model: "jobTask",
    principals: CLIENT_PEOPLE,
    purpose: "Track each return or filing through preparation, review and the human filing.",
    fields: [
      f("service", "Service", "C"),
      f("fy", "Financial year", "C"),
      f("period", "Period", "C"),
      f("title", "Title", "C"),
      f("state", "State", "C"),
      f("statutoryDueOn", "Statutory due date", "C"),
      f("internalDueOn", "Internal due date", "C"),
      f("ackRef", "Acknowledgement reference"),
      f("filedAt", "Filed at", "C"),
      f("doneAt", "Closed at", "C"),
    ],
    erasure: { kind: "anonymise", duties: "client", set: () => ({ ackRef: null }), applies: (r) => r.ackRef != null },
    rows: async (_db, s) => clientOf(s)?.jobTasks ?? [],
  },
  {
    key: "legacy-jobs",
    label: "Jobs (LMS /clients)",
    model: "job",
    principals: CLIENT_PEOPLE,
    purpose: "Track work, fees and due dates in the LMS client module.",
    fields: [f("fy", "Financial year", "C"), f("status", "Status", "C"), f("dueOn", "Due on", "C"), f("fees", "Fees (₹)", "C"), f("notes", "Notes")],
    erasure: { kind: "anonymise", duties: "client", set: () => ({ notes: null }), applies: (r) => r.notes != null },
    rows: async (_db, s) => clientOf(s)?.jobs ?? [],
  },
  {
    key: "comms-drafts",
    label: "Message drafts (Firm OS comms)",
    model: "commsDraft",
    principals: CLIENT_ANY,
    purpose: "Draft status updates and document requests for staff to send from their own mailbox.",
    fields: [f("kind", "Kind", "C"), f("language", "Language", "C"), f("subject", "Subject"), f("body", "Message"), f("createdAt", "Drafted at", "C")],
    erasure: { kind: "anonymise", duties: [], set: () => ({ subject: ERASED, body: ERASED }), applies: (r) => r.subject !== ERASED || r.body !== ERASED },
    rows: async (db, s) => {
      const fc = clientOf(s)?.firmClient;
      return fc ? finder(db, "commsDraft").findMany({ where: { firmClientId: fc.id }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "onboarding-contact",
    label: "Contact details given at onboarding (Firm OS /onboard)",
    model: "onboardingRun",
    principals: ["client-contact"],
    purpose: "Record who to contact, as typed when the client was onboarded.",
    fields: [f("contactName", "Contact name"), f("contactEmail", "Contact email"), f("contactPhone", "Contact phone")],
    // A company contact gets only their own details out of the onboarding record, not the company's.
    derived: (r) => {
      const spec = (r.spec ?? {}) as Row;
      return { contactName: spec.contactName ?? null, contactEmail: spec.contactEmail ?? null, contactPhone: spec.contactPhone ?? null };
    },
    erasure: {
      kind: "anonymise",
      duties: [],
      set: (r) => ({ prompt: ERASED, spec: { ...((r.spec ?? {}) as Row), contactName: null, contactEmail: null, contactPhone: null } as Prisma.InputJsonObject }),
      applies: (r) => {
        const spec = (r.spec ?? {}) as Row;
        return r.prompt !== ERASED || spec.contactName != null || spec.contactEmail != null || spec.contactPhone != null;
      },
    },
    rows: async (db, s) => {
      const fc = clientOf(s)?.firmClient;
      return fc ? finder(db, "onboardingRun").findMany({ where: { firmClientId: fc.id }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "onboarding-runs",
    label: "Onboarding conversations (Firm OS /onboard)",
    model: "onboardingRun",
    principals: CLIENT_PEOPLE,
    purpose: "Record how the client was onboarded: the request typed by staff and the plan created from it.",
    fields: [f("prompt", "Request as typed"), f("spec", "Details extracted"), f("status", "Status", "C"), f("createdAt", "Started at", "C")],
    erasure: {
      kind: "anonymise",
      duties: [],
      set: (r, s) => ({ prompt: ERASED, spec: erasedJson, ...(r.plan != null ? { plan: erasedJson } : {}), ...scrubColumns(r, ["error"], s) }),
      applies: (r) => r.prompt !== ERASED,
    },
    rows: async (db, s) => {
      const fc = clientOf(s)?.firmClient;
      return fc ? finder(db, "onboardingRun").findMany({ where: { firmClientId: fc.id }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "agent-runs",
    label: "Agent runs (Firm OS /agents)",
    model: "agentRun",
    principals: CLIENT_PEOPLE,
    purpose: "Prepare draft packs. Cached inputs are purged after at most 30 days (ADR-006).",
    fields: [f("agent", "Agent", "C"), f("status", "Status", "C"), f("startedAt", "Started at", "C"), f("inputsCached", "Cached inputs held", "C"), f("inputsPurgeAt", "Cached inputs purged by", "C")],
    // The cached registers name other people (customers, suppliers): the export says whether a
    // copy is held, never its content.
    derived: (r) => ({ inputsCached: r.inputs != null }),
    erasure: { kind: "anonymise", duties: [], set: () => ({ inputs: Prisma.DbNull }), applies: (r) => r.inputs != null },
    rows: async (db, s) => {
      const c = clientOf(s);
      return c && c.jobTasks.length ? finder(db, "agentRun").findMany({ where: { jobTaskId: { in: ids(c.jobTasks) } }, orderBy: { startedAt: "asc" } }) : [];
    },
  },
  {
    key: "deliverables",
    label: "Deliverables (SharePoint CL- site)",
    model: "deliverable",
    principals: CLIENT_PEOPLE,
    purpose: "Working and final files of each job, stored in the client's SharePoint site.",
    fields: [f("name", "File name"), f("kind", "Folder", "C"), f("spPath", "SharePoint path"), f("version", "Version", "C"), f("createdAt", "Saved at", "C")],
    erasure: { kind: "hold", duties: "client", reason: "Files stay in SharePoint: Firm OS never deletes SharePoint files. The firm's SharePoint retention decides when they go, after the hold date." },
    rows: async (db, s) => {
      const c = clientOf(s);
      return c && c.jobTasks.length ? finder(db, "deliverable").findMany({ where: { jobTaskId: { in: ids(c.jobTasks) } }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "client-documents",
    label: "KYC and job documents (legacy SharePoint folder)",
    model: "clientDocument",
    principals: CLIENT_PEOPLE,
    purpose: "KYC documents and job files uploaded on /clients.",
    fields: [f("docType", "Document type", "C"), f("name", "File name"), f("webUrl", "SharePoint link"), f("createdAt", "Uploaded at", "C")],
    erasure: { kind: "hold", duties: "client", reason: "Files stay in SharePoint: Firm OS never deletes SharePoint files. The firm's SharePoint retention decides when they go, after the hold date." },
    rows: async (db, s) => {
      const c = clientOf(s);
      return c ? finder(db, "clientDocument").findMany({ where: { clientId: c.client.id }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "certificates",
    label: "Certificates issued (Tools)",
    model: "certificateIssue",
    principals: CLIENT_PEOPLE,
    purpose: "Certificates the firm issued for the client, kept so they can be regenerated.",
    fields: [f("formatTitle", "Certificate", "C"), f("clientName", "Issued for"), f("payload", "Certificate details"), f("createdAt", "Issued at", "C")],
    erasure: { kind: "anonymise", duties: "client", set: () => ({ clientName: ERASED, payload: erasedJson }), applies: (r) => r.clientName !== ERASED },
    rows: async (db, s) => {
      const c = clientOf(s);
      // Re-audit NEW-8: by the client record id, never the typed name (another entity can share it).
      return c ? finder(db, "certificateIssue").findMany({ where: { clientId: String(c.client.id) }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "engagement-letters",
    label: "Engagement letters (Tools)",
    model: "engagementLetter",
    principals: CLIENT_PEOPLE,
    purpose: "Engagement letters prepared, sent and signed for the client.",
    fields: [f("fy", "Financial year", "C"), f("status", "Status", "C"), f("data", "Letter details"), f("sentTo", "Sent to"), f("createdAt", "Created at", "C")],
    erasure: {
      kind: "anonymise",
      duties: "client",
      set: (r) => ({ clientName: `${ERASED} ${String(r.id)}`, data: erasedJson, sentTo: null }),
      applies: (r) => !String(r.clientName ?? "").startsWith(ERASED),
    },
    rows: async (db, s) => {
      const c = clientOf(s);
      // Re-audit NEW-8: by the client record id, never the typed name.
      return c ? finder(db, "engagementLetter").findMany({ where: { clientId: String(c.client.id) }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "turia-tasks",
    label: "Turia task list copy (Turia pull)",
    model: "turiaTaskMirror",
    principals: CLIENT_PEOPLE,
    purpose:
      "A copy of the client's tasks in Turia, only what a job needs (task, client name and code, department, status, dates), so the work shows in Firm OS. Turia holds the record; staff names on the tasks are not included here.",
    fields: [
      f("identity", "Turia task number", "C"),
      f("taskName", "Task name"),
      f("clientName", "Client name in Turia"),
      f("clientCode", "Client code in Turia", "C"),
      f("department", "Department", "C"),
      f("statusName", "Status in Turia", "C"),
      f("dueOn", "Due on", "C"),
      f("completedOn", "Completed on", "C"),
    ],
    erasure: {
      kind: "anonymise",
      duties: "client",
      note: TURIA_SKIP_NOTE,
      // The row, its Turia task id, dates, people and the link to the job stay; the erased key makes the pull skip it.
      set: (r, _s, sc) => ({
        taskName: ERASED,
        clientName: ERASED,
        clientKey: erasedClientKey(String(r.clientKey), sc.hashKey),
        clientCode: null,
        hash: ERASED,
        ...(r.appliedHash != null ? { appliedHash: ERASED } : {}),
      }),
      applies: (r) => !isErasedKey(r.clientKey),
    },
    rows: async (db, s) => {
      const keys = clientOf(s)?.turia.keys ?? [];
      return keys.length ? finder(db, "turiaTaskMirror").findMany({ where: { clientKey: { in: keys } }, orderBy: { id: "asc" } }) : [];
    },
  },
  {
    key: "turia-client-links",
    label: "Turia client match (Turia pull)",
    model: "turiaClientLink",
    principals: CLIENT_PEOPLE,
    purpose: "How the Turia pull matches the client in Turia to the client list, so the client's Turia tasks become its jobs.",
    fields: [f("turiaName", "Client name in Turia"), f("turiaCode", "Client code in Turia", "C"), f("status", "Match", "C")],
    erasure: {
      kind: "anonymise",
      duties: "client",
      note: "The match is set to ignore under an erased key, with a privacy note as its name, so the Turia pull never maps this client again; erase or anonymise it in Turia too.",
      set: (r, _s, sc) => ({ key: erasedClientKey(String(r.key), sc.hashKey), turiaName: ERASED_CLIENT_NOTE, turiaCode: null, status: "ignored" }),
      applies: (r) => !isErasedKey(r.key),
    },
    rows: async (db, s) => {
      const c = clientOf(s);
      const keys = c?.turia.keys ?? [];
      if (!c || !keys.length) return [];
      const links = await finder(db, "turiaClientLink").findMany({ where: { key: { in: keys } }, orderBy: { key: "asc" } });
      // The row's id in the plan and the audit trail is the key it gets: no name, and the trail still points at it.
      return links.map((l) => ({ ...l, id: erasedClientKey(String(l.key), c.hashKey) }));
    },
    where: (r) => ({ key: r.key }),
  },
  // ------------------------------------------------------------------ staff (class B)
  {
    key: "staff-profile",
    label: "Staff profile (LMS)",
    model: "user",
    principals: STAFF,
    purpose: "Sign-in, work allocation, learning and performance.",
    fields: [
      f("name", "Name", "B"),
      f("email", "Email", "B"),
      f("role", "Role", "B"),
      f("level", "Level", "B"),
      f("department", "Department", "B"),
      f("active", "Active", "B"),
      f("deactivatedAt", "Left on", "B"),
      f("createdAt", "Joined the LMS on", "B"),
      f("strengths", "Strengths (Growth Wizard)", "B"),
      f("aspiration", "Aspiration (Growth Wizard)", "B"),
    ],
    erasure: {
      kind: "anonymise",
      duties: ["staff-records"],
      set: (r) => ({ name: ERASED, email: `erased+${String(r.id)}@erased.invalid`, image: null, strengths: Prisma.DbNull, aspiration: null }),
    },
    rows: async (_db, s) => (staffOf(s) ? [staffOf(s)!.user] : []),
  },
  {
    key: "staff-attendance",
    label: "Attendance imported from greytHR (LMS)",
    model: "attendanceRecord",
    principals: STAFF,
    purpose: "Attendance points for KRA scoring.",
    fields: [f("periodMonth", "Month", "B"), f("workingDays", "Working days", "B"), f("presentDays", "Days present", "B"), f("lateMarks", "Late marks", "B"), f("attendancePct", "Attendance %", "B"), f("points", "KRA points", "B")],
    erasure: { kind: "keep", reason: "Linked to the person only through their staff account; anonymous once the profile is anonymised. Kept with the employment records." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "attendanceRecord").findMany({ where: { userId: staffOf(s)!.user.id }, orderBy: { periodMonth: "asc" } }) : []),
  },
  {
    key: "staff-assignments",
    label: "Firm OS jobs assigned or reviewed",
    model: "jobTask",
    principals: STAFF,
    purpose: "Allocate and review work.",
    fields: [f("service", "Service", "C"), f("fy", "Financial year", "C"), f("period", "Period", "C"), f("title", "Title", "C"), f("state", "State", "C")],
    erasure: { kind: "keep", reason: "Firm work records; the person appears only as a staff account, not by name." },
    rows: async (db, s) => {
      const st = staffOf(s);
      return st ? finder(db, "jobTask").findMany({ where: { OR: [{ assigneeId: st.user.id }, { reviewerId: st.user.id }] }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "staff-coach",
    label: "Daily Coach preferences",
    model: "coachPreference",
    principals: STAFF,
    purpose: "The person's own choices for the morning board and break nudges.",
    fields: [f("breakNudges", "Break nudges on", "B"), f("morningBoard", "Morning board on", "B"), f("snoozeUntil", "Snoozed until", "B")],
    erasure: { kind: "keep", reason: "The person's own settings; nothing identifies them beyond their staff account." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "coachPreference").findMany({ where: { userId: staffOf(s)!.user.id } }) : []),
  },
  {
    key: "staff-heartbeats",
    label: "Activity heartbeats (break nudges)",
    model: "activityHeartbeat",
    principals: STAFF,
    purpose: "Break nudges only. Kept 7 days, never reported to managers (ADR-006).",
    fields: [f("at", "At", "B"), f("source", "Source", "B")],
    erasure: { kind: "keep", reason: "Removed automatically after 7 days by the coach's clean-up." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "activityHeartbeat").findMany({ where: { userId: staffOf(s)!.user.id }, orderBy: { at: "asc" }, take: 5000 }) : []),
  },
  {
    key: "staff-turia-link",
    label: "Turia user match (Turia pull)",
    model: "turiaPersonLink",
    principals: STAFF,
    purpose: "How the Turia pull matches the person's Turia user to their staff account, so Turia tasks assigned to them become their jobs.",
    fields: [f("turiaName", "Name in Turia", "B"), f("turiaEmail", "Email in Turia", "B"), f("matchedBy", "Matched by", "B")],
    erasure: {
      kind: "anonymise",
      duties: ["staff-records"],
      note: "The match is marked erased and unlinked from the staff account, so the Turia pull never matches this Turia user again and writes \"[erased]\" for their name.",
      set: () => ({ turiaName: ERASED, turiaEmail: null, userId: null, matchedBy: ERASED_PERSON }),
      applies: (r) => r.matchedBy !== ERASED_PERSON,
    },
    rows: async (db, s) => {
      const st = staffOf(s);
      if (!st) return [];
      const links = await finder(db, "turiaPersonLink").findMany({ where: { userId: st.user.id }, orderBy: { turiaUserId: "asc" } });
      return links.map((l) => ({ ...l, id: String(l.turiaUserId) }));
    },
    where: (r) => ({ turiaUserId: r.turiaUserId }),
  },
  {
    key: "staff-turia-tasks",
    label: "Turia tasks assigned or reviewed (Turia pull copy)",
    model: "turiaTaskMirror",
    principals: STAFF,
    purpose: "The Turia tasks the person is the assignee or reviewer of, copied so the work shows in Firm OS. Turia holds the record. Other people's names, and the client's, are withheld.",
    fields: [
      f("identity", "Turia task number", "C"),
      f("taskName", "Task name", "C"),
      f("department", "Department", "C"),
      f("statusName", "Status in Turia", "C"),
      f("dueOn", "Due on", "C"),
      f("role", "Your role", "B"),
      f("assignees", "Assignees", "B"),
      f("reviewers", "Reviewers", "B"),
    ],
    derived: (r, s) => staffTaskView(r, staffOf(s)?.turia.ids ?? []),
    erasure: {
      kind: "anonymise",
      duties: ["staff-records"],
      // Only the person's own entries change; the other people on the task, and the task, stay.
      set: (r, _s, sc) => {
        const own = new Set(staffOf(sc)?.turia.ids ?? []);
        return { assignees: hidePeople(r.assignees, own), reviewers: hidePeople(r.reviewers, own) };
      },
      applies: (r, _s, sc) => {
        const own = new Set(staffOf(sc)?.turia.ids ?? []);
        return [...peopleOf(r.assignees), ...peopleOf(r.reviewers)].some((p) => own.has(p.id) && p.name !== ERASED);
      },
    },
    rows: async (db, s) => {
      const ids = staffOf(s)?.turia.ids ?? [];
      if (!ids.length) return [];
      const OR = ids.flatMap((id) => [{ assignees: { array_contains: [{ id }] } }, { reviewers: { array_contains: [{ id }] } }]);
      return finder(db, "turiaTaskMirror").findMany({ where: { OR }, orderBy: { id: "asc" } });
    },
  },
  // ------------------------------------------------------------------ SOP Builder (SOP review H1; see the block at the end)
  {
    key: "sop-screenshots",
    label: "SOP screenshots (Tools > SOP Builder)",
    model: "sopImage",
    principals: CLIENT_ANY,
    purpose:
      "Pictures of the firm's software under SOP steps, showing a new joiner where to click. They should show a demo company; these are the ones under steps whose words name the person, so they may show the person's details.",
    fields: [f("stepNo", "Step", "C"), f("caption", "Caption"), f("bytes", "Screenshot"), f("createdAt", "Added at", "C"), f("removedAt", "Removed at", "C")],
    // The picture itself is not put in the file: its link opens it for a partner, who shares a copy on request.
    derived: (r) => ({ bytes: `/api/tools/sop-builder/sops/${String(r.sopId)}/images/${String(r.id)}` }),
    // No retention duty (a how-to picture, not a working paper): the picture is blanked in place, never deleted.
    erasure: { kind: "anonymise", duties: [], set: () => ({ bytes: new Uint8Array(0), removedAt: new Date() }), applies: (r) => r.removedAt == null },
    rows: (db, s) => sopScreenshotRows(db, s),
  },
];

// ------------------------------------------------------------------ Turia pull helpers

type TuriaPerson = { id: string; name: string };
const peopleOf = (v: unknown): TuriaPerson[] =>
  Array.isArray(v) ? (v as Row[]).filter((p) => p && typeof p.id === "string").map((p) => ({ id: String(p.id), name: String(p.name ?? "") })) : [];

/** The list with the given Turia users' names replaced by "[erased]" (ids and everyone else unchanged). */
function hidePeople(v: unknown, own: ReadonlySet<string>): Prisma.InputJsonValue {
  if (!Array.isArray(v)) return (v ?? []) as Prisma.InputJsonValue;
  return (v as Row[]).map((p) => (p && own.has(String(p.id)) ? { ...p, name: ERASED } : p)) as Prisma.InputJsonValue;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A staff member's view of a mirrored task: their own name, other people's and the client's withheld. */
function staffTaskView(r: Row, ids: readonly string[]): Row {
  const own = new Set(ids);
  const view = (v: unknown) => peopleOf(v).map((p) => (own.has(p.id) ? p.name : WITHHELD_THIRD_PARTY));
  const client = String(r.clientName ?? "").trim();
  const taskName = String(r.taskName ?? "");
  return {
    taskName: client.length > 2 ? taskName.replace(new RegExp(escapeRe(client), "gi"), WITHHELD_THIRD_PARTY) : taskName,
    role: [peopleOf(r.assignees).some((p) => own.has(p.id)) ? "assignee" : null, peopleOf(r.reviewers).some((p) => own.has(p.id)) ? "reviewer" : null].filter(Boolean),
    assignees: view(r.assignees),
    reviewers: view(r.reviewers),
  };
}

type ReportItem = { client?: unknown; task?: unknown; detail?: unknown };
const reportItems = (preview: unknown): ReportItem[] => (Array.isArray(preview) ? (preview as ReportItem[]).filter((i) => i && typeof i === "object") : []);
const liveKeys = (keys: readonly string[]) => new Set(keys.filter((k) => k && !isErasedKey(k)));
const aboutClient = (i: ReportItem, keys: ReadonlySet<string>) => typeof i.client === "string" && keys.has(normName(i.client));

/** Does a run report list a task of this client (by the client key the pull matches on)? */
function reportMentions(preview: unknown, keys: readonly string[]): boolean {
  const live = liveKeys(keys);
  return live.size > 0 && reportItems(preview).some((i) => aboutClient(i, live));
}

/** The report with this client's lines cleaned: its name withheld, its names and identifiers in the task and detail erased. */
function scrubReport(preview: unknown, keys: readonly string[], s: Scrubber): Prisma.InputJsonValue {
  const live = liveKeys(keys);
  if (!Array.isArray(preview)) return (preview ?? []) as Prisma.InputJsonValue;
  return (preview as ReportItem[]).map((i) =>
    i && typeof i === "object" && aboutClient(i, live) ? { ...i, client: ERASED, task: s.text(String(i.task ?? "")), detail: s.text(String(i.detail ?? "")) } : i,
  ) as Prisma.InputJsonValue;
}

const RUN_PAGE = 500;

/** The Turia pull run reports that `keep` selects, read in pages (every run keeps its report). */
async function runReports(db: PrivacyReadDb, keep: (r: Row) => boolean): Promise<Row[]> {
  const out: Row[] = [];
  let after: string | null = null;
  for (;;) {
    const page: Row[] = await finder(db, "turiaPullRun").findMany({ where: after ? { id: { gt: after } } : {}, orderBy: { id: "asc" }, take: RUN_PAGE, select: { id: true, preview: true } });
    for (const r of page) if (r.preview != null && keep(r)) out.push(r);
    if (page.length < RUN_PAGE) return out;
    after = String(page[page.length - 1].id);
  }
}

export const datasetsFor = (t: PrincipalType) => DATASETS.filter((d) => d.principals.includes(t));

// ------------------------------------------------------------------ residue (erasure only)

/**
 * The person's needles (scrub.ts): a client principal gets the client master's names and
 * identifiers; a company's contact person only their own name, email and phone (the company is not
 * a data principal); staff their name and email.
 */
export function needlesFor(s: Scope): Needle[] {
  if (s.kind === "staff") {
    // Turia's spelling of the person counts too; a name another person shares never does.
    return [
      s.turia.nameShared || !liveText(s.user.name) ? null : phraseNeedle(s.user.name, "name"),
      liveText(s.user.email) ? codeNeedle(s.user.email) : null,
      ...s.turia.names.map((n) => phraseNeedle(n, "name")),
      ...s.turia.emails.map((e) => codeNeedle(e)),
    ].filter((n): n is Needle => n !== null);
  }
  // A client person's filings are theirs too: acknowledgement numbers (ARN / SRN / ITR ack) found in
  // notes; and the names Turia gives the client.
  if (s.principalType === "client-person") {
    return [
      ...clientNeedles(s.client),
      ...s.jobTasks.map((j) => (j.ackRef ? codeNeedle(j.ackRef) : null)),
      ...s.turia.names.map((n) => phraseNeedle(n, "name")),
    ].filter((n): n is Needle => n !== null);
  }
  const c = s.client;
  return [codeNeedle(c.contactEmail), phoneNeedle(c.contactPhone), phraseNeedle(c.contactName, "name"), ...namePartNeedles(c.contactName)].filter((n): n is Needle => n !== null);
}

const scrubbers = new WeakMap<Scope, Scrubber>();
/** One scrubber per scope (scopes are loaded afresh for each plan). */
export function scrubberOf(s: Scope): Scrubber {
  let sc = scrubbers.get(s);
  if (!sc) {
    sc = scrubberFor(needlesFor(s));
    scrubbers.set(s, sc);
  }
  return sc;
}

/** The work records linked to one client, read once per plan: their ids find audit rows and child rows. */
interface Linked {
  runs: Row[];
  drafts: Row[];
  onboarding: Row[];
  orphans: Row[];
  mistakes: Row[];
  turia: Row[];
  deliverables: Row[];
  requests: Row[];
  certificates: Row[];
  letters: Row[];
}

const linkedCache = new WeakMap<ClientScope, Promise<Linked>>();
const ORPHAN_SCAN_LIMIT = 5000;

/**
 * The identifiers that pin this person alone, for finding rows NOT linked to their record: PAN,
 * GSTIN and CIN of a client person; contact email and phone only when no other client record shares
 * them (a family phone or an office email must never pull in someone else's onboarding — the
 * single-principal rule). Names never count.
 */
async function ownIdentifiers(db: PrivacyReadDb, s: ClientScope): Promise<Scrubber> {
  const c = s.client;
  const others = async (where: Row) => (await finder(db, "client").findMany({ where: { ...where, id: { not: String(c.id) } }, select: { id: true }, take: 1 })).length > 0;
  const list: (Needle | null)[] = [];
  if (s.principalType === "client-person") list.push(c.pan ? panNeedle(c.pan) : null, c.gstin ? codeNeedle(c.gstin) : null, c.cin ? codeNeedle(c.cin) : null);
  const email = typeof c.contactEmail === "string" ? c.contactEmail.trim() : "";
  const phone = typeof c.contactPhone === "string" ? c.contactPhone.trim() : "";
  if (email && !(await others({ contactEmail: { equals: email, mode: "insensitive" } }))) list.push(codeNeedle(email));
  if (phone && !(await others({ contactPhone: phone }))) list.push(phoneNeedle(phone));
  return scrubberFor(list.filter((n): n is Needle => n !== null));
}

async function loadLinked(db: PrivacyReadDb, s: ClientScope): Promise<Linked> {
  const fc = s.firmClient;
  const jobIds = ids(s.jobTasks);
  const runs = jobIds.length ? await finder(db, "agentRun").findMany({ where: { jobTaskId: { in: jobIds } }, orderBy: { startedAt: "asc" } }) : [];
  const runIds = ids(runs);
  const turiaWhere = [...(jobIds.length ? [{ jobTaskId: { in: jobIds } }] : []), ...(fc ? [{ firmClientId: fc.id }] : [])];
  // An onboarding that failed before the client record existed has no firmClientId: it is found by
  // the identifiers that pin this person alone (ownIdentifiers) in its prompt or extracted details,
  // never by a name and never by a phone or email another client shares.
  const sc = await ownIdentifiers(db, s);
  const unlinked = await finder(db, "onboardingRun").findMany({ where: { firmClientId: null }, orderBy: { createdAt: "asc" }, take: ORPHAN_SCAN_LIMIT });
  return {
    runs,
    drafts: fc ? await finder(db, "commsDraft").findMany({ where: { firmClientId: fc.id }, orderBy: { createdAt: "asc" } }) : [],
    onboarding: fc ? await finder(db, "onboardingRun").findMany({ where: { firmClientId: fc.id }, orderBy: { createdAt: "asc" } }) : [],
    orphans: unlinked.filter((r) => sc.hits([r.prompt, r.spec, r.plan], ["id"])),
    mistakes: runIds.length ? await finder(db, "mistakeLog").findMany({ where: { agentRunId: { in: runIds } }, orderBy: { createdAt: "asc" } }) : [],
    turia: turiaWhere.length ? await finder(db, "turiaSync").findMany({ where: { OR: turiaWhere }, orderBy: { createdAt: "asc" } }) : [],
    deliverables: jobIds.length ? await finder(db, "deliverable").findMany({ where: { jobTaskId: { in: jobIds } }, orderBy: { createdAt: "asc" } }) : [],
    requests: await finder(db, "privacyRequest").findMany({ where: { principalRef: String(s.client.id) }, orderBy: { createdAt: "asc" } }),
    certificates: await finder(db, "certificateIssue").findMany({ where: { clientId: String(s.client.id) }, select: { id: true } }),
    letters: await finder(db, "engagementLetter").findMany({ where: { clientId: String(s.client.id) }, select: { id: true } }),
  };
}

function linked(db: PrivacyReadDb, s: Scope): Promise<Linked> | null {
  const c = clientOf(s);
  if (!c) return null;
  let p = linkedCache.get(c);
  if (!p) {
    p = loadLinked(db, c);
    linkedCache.set(c, p);
  }
  return p;
}

/** AuditEvent rows on the client's work records (not the privacy register: that is its own dataset). */
async function workAuditRows(db: PrivacyReadDb, s: Scope): Promise<Row[]> {
  const c = clientOf(s);
  const l = await linked(db, s);
  if (!c || !l) return [];
  const on: [string, string[]][] = [
    ["Client", [String(c.client.id)]],
    ["FirmClient", c.firmClient ? [String(c.firmClient.id)] : []],
    ["JobTask", ids(c.jobTasks)],
    ["Job", ids(c.jobs)],
    ["Engagement", ids(c.engagements)],
    ["AgentRun", ids(l.runs)],
    ["CommsDraft", ids(l.drafts)],
    ["OnboardingRun", ids([...l.onboarding, ...l.orphans])],
    ["MistakeLog", ids(l.mistakes)],
    ["TuriaSync", ids(l.turia)],
    ["Deliverable", ids(l.deliverables)],
    ["CertificateIssue", ids(l.certificates)],
    ["EngagementLetter", ids(l.letters)],
  ];
  const OR = on.filter(([, list]) => list.length).map(([entity, list]) => ({ entity, entityId: { in: list } }));
  return OR.length ? finder(db, "auditEvent").findMany({ where: { OR }, orderBy: { createdAt: "asc" } }) : [];
}

/** Rows of a child table whose parent ids come from the linked records. */
const childRows = (model: ModelName, key: string, parent: (l: Linked, c: ClientScope) => string[]) => async (db: PrivacyReadDb, s: Scope) => {
  const c = clientOf(s);
  const l = await linked(db, s);
  if (!c || !l) return [];
  const list = parent(l, c);
  return list.length ? finder(db, model).findMany({ where: { [key]: { in: list } }, orderBy: { createdAt: "asc" } }) : [];
};

/** Anonymise the listed columns where the person's identifiers occur in them. */
const scrubRule = (columns: readonly string[], duties: "client" | readonly DutyId[]): ErasureRule => ({
  kind: "anonymise",
  duties,
  set: (r, s) => scrubColumns(r, columns, s),
  applies: (r, s) => s.hits(columns.map((c) => r[c])),
});

const WORK_RECORD =
  "Kept with the engagement's working papers (review trail, findings, figures), so they are held while a retention duty applies and anonymised in place after it.";

const ORPHAN_PURPOSE = "A failed or abandoned onboarding: the request typed by staff and the details extracted from it. No engagement started, so no duty applies.";
const ORPHAN_FIELDS = [f("prompt", "Request as typed"), f("spec", "Details extracted"), f("plan", "Onboarding plan")];

/** The whole onboarding conversation of the person: prompt, extracted details and plan. */
export const eraseOnboardingRun = (r: Row, s: Scrubber): Row => ({
  prompt: ERASED,
  spec: erasedJson,
  ...(r.plan != null ? { plan: erasedJson } : {}),
  ...scrubColumns(r, ["error", "steps"], s),
});

/**
 * Erasure-only datasets: free text and JSON that copy the person's identifiers. Each is anonymised
 * in place (identifiers → "[erased]"); a legal hold applies per dataset:
 *   duties "client"  part of the engagement record (working papers, review trail): held while any
 *                    retention duty applies (ICAI SQC 1 / SA 230, Income-tax, GST, Companies Act)
 *   duties []        a derived copy of data the client master or another system already holds:
 *                    anonymised even while the client's own records are on hold
 */
export const RESIDUE_DATASETS: readonly DataSet[] = [
  {
    key: "audit-trail-notes",
    label: "Audit trail: comments, transition notes, correction reasons",
    model: "auditEvent",
    principals: CLIENT_ANY,
    purpose: `Accountability for work on the client's records. ${WORK_RECORD}`,
    fields: [f("meta", "Audit details")],
    erasure: { kind: "anonymise", duties: "client", set: (r, s) => ({ meta: s.json(r.meta) }), applies: (r, s) => s.hits(r.meta) },
    rows: workAuditRows,
  },
  {
    key: "agent-run-notes",
    label: "Agent runs: figures, review notes and errors",
    model: "agentRun",
    principals: CLIENT_ANY,
    purpose: `Draft packs prepared by task agents. ${WORK_RECORD} Numbers are never changed.`,
    fields: [f("figures", "Computed figures"), f("reviewNotes", "Review notes"), f("error", "Failure reason")],
    erasure: scrubRule(["figures", "reviewNotes", "error"], "client"),
    rows: async (db, s) => (await linked(db, s))?.runs ?? [],
  },
  {
    key: "checklist-findings",
    label: "Checklist findings of agent runs",
    model: "checklistResult",
    principals: CLIENT_ANY,
    purpose: `Each finding quotes the input it rests on (ADR-008). ${WORK_RECORD}`,
    fields: [f("message", "Finding"), f("evidence", "Evidence quoted")],
    erasure: scrubRule(["message", "evidence"], "client"),
    rows: childRows("checklistResult", "agentRunId", (l) => ids(l.runs)),
  },
  {
    key: "job-history-notes",
    label: "Job history notes",
    model: "jobTaskEvent",
    principals: CLIENT_ANY,
    purpose: `Notes typed on job transitions and the close-gate evidence. ${WORK_RECORD}`,
    fields: [f("note", "Note")],
    erasure: scrubRule(["note"], "client"),
    rows: childRows("jobTaskEvent", "jobTaskId", (_l, c) => ids(c.jobTasks)),
  },
  {
    key: "deliverable-names",
    label: "Deliverable file names (pointers to SharePoint)",
    model: "deliverable",
    principals: CLIENT_ANY,
    purpose: "Pointers to the job's files in SharePoint. The file itself stays in SharePoint (held); only the pointer's name and path are cleaned, its id and SHA-256 stay.",
    fields: [f("name", "File name"), f("spPath", "SharePoint path")],
    erasure: scrubRule(["name", "spPath"], "client"),
    rows: async (db, s) => (await linked(db, s))?.deliverables ?? [],
  },
  {
    key: "turia-bridge-evidence",
    label: "Turia manual-bridge checklists",
    model: "turiaSync",
    principals: CLIENT_ANY,
    purpose: "Values a person typed into Turia, prefilled from the client master. A copy: Turia and the client master hold the record.",
    fields: [f("evidence", "Checklist and confirmation"), f("spotCheckNote", "Spot-check note", "B")],
    erasure: scrubRule(["evidence", "spotCheckNote"], []),
    rows: async (db, s) => (await linked(db, s))?.turia ?? [],
  },
  {
    key: "mistake-examples",
    label: "Mistake log examples",
    model: "mistakeLog",
    principals: CLIENT_ANY,
    purpose: "The run's extraction kept to replay a proposed checklist rule. A copy of the run's data; the rule itself is kept.",
    fields: [f("pattern", "What was missed", "B"), f("example", "Example")],
    erasure: scrubRule(["pattern", "example"], []),
    rows: async (db, s) => (await linked(db, s))?.mistakes ?? [],
  },
  {
    key: "coach-nudges",
    label: "Daily Coach reminders and escalations",
    model: "coachEvent",
    principals: CLIENT_ANY,
    purpose: "Nudges to staff about the client's jobs. A copy of the job label.",
    fields: [f("payload", "Nudge text")],
    erasure: scrubRule(["payload"], []),
    rows: childRows("coachEvent", "jobTaskId", (_l, c) => ids(c.jobTasks)),
  },
  {
    key: "model-call-errors",
    label: "Model call errors",
    model: "modelCall",
    principals: CLIENT_ANY,
    purpose: "Usage log of model calls (ADR-002). The error text is a provider message; it should hold no client text.",
    fields: [f("error", "Error text")],
    erasure: scrubRule(["error"], []),
    rows: childRows("modelCall", "runId", (l) => ids([...l.runs, ...l.onboarding, ...l.orphans, ...l.drafts])),
  },
  {
    key: "onboarding-orphans",
    label: "Onboarding runs that never reached a client record",
    model: "onboardingRun",
    principals: CLIENT_PEOPLE,
    purpose: ORPHAN_PURPOSE,
    fields: ORPHAN_FIELDS,
    erasure: { kind: "anonymise", duties: [], set: eraseOnboardingRun, applies: (r) => r.prompt !== ERASED },
    rows: async (db, s) => (await linked(db, s))?.orphans ?? [],
  },
  {
    key: "onboarding-orphan-contacts",
    label: "Onboarding runs that never reached a client record (contact details)",
    model: "onboardingRun",
    principals: ["client-contact"],
    purpose: ORPHAN_PURPOSE,
    fields: ORPHAN_FIELDS,
    // A company's contact person: only their own details are cleaned, not the company's.
    erasure: scrubRule(["prompt", "spec", "plan", "error"], []),
    rows: async (db, s) => (await linked(db, s))?.orphans ?? [],
  },
  {
    key: "privacy-request-notes",
    label: "Privacy register: notes and replies",
    model: "privacyRequest",
    principals: CLIENT_ANY,
    purpose: "The firm's record of the person's DPDP requests. The request itself (kind, dates, status, masked label) is kept for accountability; names typed into its notes are cleaned.",
    fields: [f("notes", "Notes"), f("outcome", "Outcome")],
    erasure: scrubRule(["notes", "outcome"], []),
    rows: async (db, s) => (await linked(db, s))?.requests ?? [],
  },
  {
    key: "privacy-register-audit",
    label: "Privacy register: audit notes",
    model: "auditEvent",
    principals: CLIENT_ANY,
    purpose: "Audit rows of the person's DPDP requests (identity-check notes, replies). Their structure is kept; names typed into them are cleaned.",
    fields: [f("meta", "Audit details")],
    erasure: { kind: "anonymise", duties: [], set: (r, s) => ({ meta: s.json(r.meta) }), applies: (r, s) => s.hits(r.meta) },
    rows: async (db, s) => {
      const l = await linked(db, s);
      const list = l ? ids(l.requests) : [];
      return list.length ? finder(db, "auditEvent").findMany({ where: { entity: "PrivacyRequest", entityId: { in: list } }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "turia-client-link-audit",
    label: "Audit trail of the Turia client match",
    model: "auditEvent",
    principals: CLIENT_PEOPLE,
    purpose:
      "Who changed how the Turia client is matched. Its record reference is the client's name in Turia: it moves to the erased key with the match, so the trail still points at the record. Held with the match while a retention duty applies.",
    fields: [f("entityId", "Record reference"), f("meta", "Audit details")],
    erasure: {
      kind: "anonymise",
      duties: "client",
      set: (r, s, sc) => ({ entityId: erasedClientKey(String(r.entityId), sc.hashKey), ...scrubColumns(r, ["meta"], s) }),
      applies: (r) => !isErasedKey(r.entityId),
    },
    rows: async (db, s) => {
      const keys = [...liveKeys(clientOf(s)?.turia.keys ?? [])];
      return keys.length ? finder(db, "auditEvent").findMany({ where: { entity: "TuriaClientLink", entityId: { in: keys } }, orderBy: { createdAt: "asc" } }) : [];
    },
  },
  {
    key: "turia-pull-reports",
    label: "Turia pull run reports",
    model: "turiaPullRun",
    principals: CLIENT_PEOPLE,
    purpose: "Each Turia pull run keeps a report of the tasks it planned, with the client's name as Turia spells it. A copy of Turia's task list: the client's lines are cleaned at once.",
    fields: [f("preview", "Run report")],
    erasure: {
      kind: "anonymise",
      duties: [],
      set: (r, s, sc) => ({ preview: scrubReport(r.preview, clientOf(sc)?.turia.keys ?? [], s) }),
      applies: (r, _s, sc) => reportMentions(r.preview, clientOf(sc)?.turia.keys ?? []),
    },
    rows: async (db, s) => {
      const keys = clientOf(s)?.turia.keys ?? [];
      return liveKeys(keys).size ? runReports(db, (r) => reportMentions(r.preview, keys)) : [];
    },
  },
  {
    key: "staff-turia-pull-reports",
    label: "Turia pull run reports",
    model: "turiaPullRun",
    principals: STAFF,
    purpose: "Each Turia pull run keeps a report of the jobs it made or changed, naming the preparer and reviewer. A copy: the person's names are cleaned at once (a name another person shares is left).",
    fields: [f("preview", "Run report", "B")],
    erasure: scrubRule(["preview"], []),
    rows: async (db, s) => {
      const sc = scrubberOf(s);
      return sc.needles.length ? runReports(db, (r) => sc.hits(r.preview)) : [];
    },
  },
  // ------------------------------------------------------------------ SOP Builder (SOP review H1; see the block at the end)
  {
    key: "sop-text",
    label: "SOP text: descriptions, gap answers, captions and authors (Tools > SOP Builder)",
    model: "sopVersion",
    principals: [...CLIENT_ANY, ...STAFF],
    purpose:
      "SOPs are firm guidance. A client's name typed into a description, a gap answer or a caption is a copy, cleaned in place. A staff author's name (Prepared by, version author) is kept with their employment records, then cleaned.",
    fields: [f("purpose", "Purpose"), f("rawProcedure", "Description and gap answers"), f("brief", "Brief"), f("content", "SOP text, captions and Prepared by"), f("creatorName", "Version author", "B")],
    erasure: scrubRule(["purpose", "rawProcedure", "brief", "content", "creatorName"], ["staff-records"]),
    rows: (db, s) => sopVersionRows(db, s),
  },
];

/**
 * Re-audit NEW-8: certificates and engagement letters typed with this client's name but NOT linked
 * to the client record (clientId empty: issued before the link existed, or for another entity with
 * the same name). They are never exported or erased automatically: the plan and the export name them
 * as a manual check for a partner.
 */
export async function nameOnlyRecords(db: PrivacyReadDb, client: Row): Promise<{ certificates: number; letters: number }> {
  const name = String(client.name ?? "").trim();
  if (!name) return { certificates: 0, letters: 0 };
  const where = { clientName: name, clientId: null };
  const [certificates, letters] = await Promise.all([
    finder(db, "certificateIssue").findMany({ where, select: { id: true } }),
    finder(db, "engagementLetter").findMany({ where, select: { id: true } }),
  ]);
  return { certificates: certificates.length, letters: letters.length };
}

/** The manual-check sentence for name-only records (null when there are none). */
export function nameOnlySentence(n: { certificates: number; letters: number }): string | null {
  const parts = [n.certificates ? `${n.certificates} certificate${n.certificates === 1 ? "" : "s"}` : "", n.letters ? `${n.letters} engagement letter${n.letters === 1 ? "" : "s"}` : ""].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join(" and ")} carry this client's name but are not linked to the client record, so they may belong to another person or business with the same name. They are not included or changed automatically: a partner should open them in the certificate and letter tools and decide by hand.`;
}

/** Systems outside Firm OS that also hold the client's data. Firm OS never deletes in them. */
export const EXTERNAL_SYSTEMS = [
  {
    key: "turia",
    label: "Turia (practice.turia.in)",
    detail:
      "Turia is the firm's record of clients, services and time. Firm OS never changes or deletes Turia records. After the hold date, a partner asks the Turia admin to archive or anonymise the client there. Firm OS's own copy of Turia's task list (the Turia pull) is anonymised here, and the client is set to be ignored so the next pull does not copy it back; until Turia is cleaned, the client's tasks stay in Turia.",
  },
  {
    key: "sharepoint",
    label: "SharePoint (CL- site and legacy client folder)",
    detail: "Firm OS never deletes SharePoint sites, folders or files. The firm's SharePoint retention policy decides disposal after the hold date; the folder name may still carry the client's name until IT renames it.",
  },
  {
    key: "audit-log",
    label: "Firm OS audit log",
    detail: "Audit records keep no raw personal data (values are masked, ADR-006) and are kept for accountability.",
  },
] as const;

/** Who the data is shared with (DPDP Act s.11(1)(b)), for the access summary. */
export const SHARED_WITH = [
  "Microsoft 365 (SharePoint, Outlook) inside the firm's tenant, as the document store and mailbox.",
  "Turia, the firm's practice-management system.",
  "Cloud AI models (Anthropic Claude; xAI Grok as a fallback) only after names and identifiers are masked (ADR-006). Masked text is not personal data in the form it is sent.",
] as const;

// ------------------------------------------------------------------ SOP Builder (SOP review H1)
//
// SOPs are firm guidance, not client records, so nothing links them to a client. But staff type
// clients' names into descriptions, gap answers and captions, and a screenshot can show a client
// despite the hiding (ADR-006 class A, may). They are found by the person's needles in the SOP text:
//   sop-text         (residue) every SOP version whose free text holds the person's needles
//   sop-screenshots  (dataset) the screenshots under steps whose words or caption hold them
// A picture itself cannot be searched, so the access export and the erasure plan also carry a
// manual check for a partner (sopManualChecks). An erased screenshot is blanked in the database at
// once; the SOPs' Word files in OneDrive keep it until they are filed again (the SOP page flags them).

/** How many SOP versions one plan reads (newest first). */
const SOP_SCAN_LIMIT = 5000;
const SOP_TEXT_COLUMNS = ["purpose", "rawProcedure", "brief", "content", "creatorName"] as const;

type SopStepText = { no?: string; role?: string; action?: string; system?: string; input?: string; output?: string; ifThen?: string[]; screens?: { imageId: string; caption?: string }[] };
const sopSteps = (content: unknown): SopStepText[] => ((content as { subProcesses?: { steps?: SopStepText[] }[] } | null)?.subProcesses ?? []).flatMap((p) => p.steps ?? []);

/** SOP versions whose free text holds one of the person's needles. */
async function sopVersionRows(db: PrivacyReadDb, s: Scope): Promise<Row[]> {
  const sc = scrubberOf(s);
  const rows = await finder(db, "sopVersion").findMany({
    where: {},
    select: { id: true, sopId: true, versionNumber: true, purpose: true, rawProcedure: true, brief: true, content: true, creatorName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SOP_SCAN_LIMIT,
  });
  return rows.filter((r) => sc.hits(SOP_TEXT_COLUMNS.map((c) => r[c])));
}

/** Live screenshots under steps whose words or caption hold one of the person's needles (never the picture bytes). */
async function sopScreenshotRows(db: PrivacyReadDb, s: Scope): Promise<Row[]> {
  if (!clientOf(s)) return [];
  const sc = scrubberOf(s);
  const found = new Map<string, { stepNo: string; caption: string }>();
  for (const v of await sopVersionRows(db, s)) {
    for (const st of sopSteps(v.content)) {
      for (const x of st.screens ?? []) {
        if (sc.hits([st.role, st.action, st.system, st.input, st.output, st.ifThen, x.caption])) found.set(x.imageId, { stepNo: st.no ?? "", caption: x.caption ?? "" });
      }
    }
  }
  if (!found.size) return [];
  const images = await finder(db, "sopImage").findMany({ where: { id: { in: [...found.keys()] }, removedAt: null }, select: { id: true, sopId: true, createdAt: true, removedAt: true } });
  return images.map((r) => ({ ...r, ...found.get(String(r.id)) }));
}

/**
 * The partner's manual steps for SOP screenshots: pictures cannot be searched for a person's details,
 * and an erased screenshot stays in the SOPs' Word files in OneDrive until they are filed again.
 * Empty when the SOP Builder holds no screenshot.
 */
export async function sopManualChecks(db: PrivacyReadDb, opts: { erasing?: boolean } = {}): Promise<{ key: string; label: string; detail: string }[]> {
  const live = (await finder(db, "sopImage").findMany({ where: { removedAt: null }, select: { id: true }, take: 100_000 })).length;
  const out: { key: string; label: string; detail: string }[] = [];
  if (live)
    out.push({
      key: "sop-screenshots-manual",
      label: "SOP screenshots (Tools > SOP Builder)",
      detail: `The SOP Builder holds ${live} screenshot${live === 1 ? "" : "s"} of the firm's software. A picture cannot be searched for a person's details, so only the screenshots under SOP steps that name this person are listed. A partner should look through the SOPs and use Remove this screen on any screenshot that shows the person.`,
    });
  if (opts.erasing)
    out.push({
      key: "sop-onedrive",
      label: "SOP Word files in OneDrive (shared L&D folder)",
      detail:
        "Erased SOP screenshots are blanked at once in the SOP Builder, but the SOPs' Word files in OneDrive keep them until they are saved again. After confirming, open each SOP: the page marks every version whose Word file still shows a removed screen. Use Save to OneDrive on each, then delete the earlier copies from the file's version history in OneDrive.",
    });
  return out;
}

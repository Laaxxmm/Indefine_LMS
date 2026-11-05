// Personal data Firm OS and the LMS client master hold about one data principal, as data: which
// table, which fields (ADR-006 class A client data / B staff data / C firm data), why it is held,
// and what erasure does to it. The access export and the erasure plan both walk this list, so a
// field added here is exported and planned for in one place.
//
// Built from ADR-006 and prisma/schema.prisma. docs/dpdp/data-inventory.md (hardening branch) was
// not on this branch when this was written: reconcile the two after merge.
//
// Deliberately left out of the export: AgentRun inputs and figures (cached registers and
// computations that also name the client's customers and suppliers — other people's data), staff
// ids on client records (staff data, ADR-006 class B), and anything matched only by a shared name.
import { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import type { DutyId, PrincipalType } from "./policy";

export type Row = Record<string, unknown>;

export type PrivacyDb = Pick<
  typeof prisma,
  | "client"
  | "firmClient"
  | "jobTask"
  | "job"
  | "engagement"
  | "commsDraft"
  | "onboardingRun"
  | "agentRun"
  | "deliverable"
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
}

export interface StaffScope {
  kind: "staff";
  user: Row;
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
  | { kind: "anonymise"; duties: "client" | readonly DutyId[]; set: (row: Row) => Row; applies?: (row: Row) => boolean }
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
  derived?: (row: Row) => Row;
  erasure: ErasureRule;
  rows(db: PrivacyReadDb, scope: Scope): Promise<Row[]>;
}

type Finder = { findMany(args: { where: Row; select?: Row; orderBy?: Row; take?: number }): Promise<Row[]> };
const finder = (db: PrivacyReadDb, model: ModelName) => db[model] as unknown as Finder;

const ERASED = "[erased]";
const erasedJson = { erased: true } as const;
const CLIENT_PEOPLE: readonly PrincipalType[] = ["client-person"];
const CLIENT_ANY: readonly PrincipalType[] = ["client-person", "client-contact"];
const STAFF: readonly PrincipalType[] = ["staff"];

const f = (name: string, label: string, cls: DataField["cls"] = "A"): DataField => ({ name, label, cls });
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
      f("industry", "Industry", "C"),
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
      set: (r) => ({ prompt: ERASED, spec: erasedJson, ...(r.plan != null ? { plan: erasedJson } : {}) }),
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
      return c ? finder(db, "certificateIssue").findMany({ where: { clientName: String(c.client.name) }, orderBy: { createdAt: "asc" } }) : [];
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
      return c ? finder(db, "engagementLetter").findMany({ where: { clientName: String(c.client.name) }, orderBy: { createdAt: "asc" } }) : [];
    },
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
    erasure: { kind: "keep", reason: "Linked to the person only by user id; anonymous once the profile is anonymised. Kept with the employment records." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "attendanceRecord").findMany({ where: { userId: staffOf(s)!.user.id }, orderBy: { periodMonth: "asc" } }) : []),
  },
  {
    key: "staff-assignments",
    label: "Firm OS jobs assigned or reviewed",
    model: "jobTask",
    principals: STAFF,
    purpose: "Allocate and review work.",
    fields: [f("service", "Service", "C"), f("fy", "Financial year", "C"), f("period", "Period", "C"), f("title", "Title", "C"), f("state", "State", "C")],
    erasure: { kind: "keep", reason: "Firm work records; the person appears only as a user id." },
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
    erasure: { kind: "keep", reason: "The person's own settings; no identifiers beyond the user id." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "coachPreference").findMany({ where: { userId: staffOf(s)!.user.id } }) : []),
  },
  {
    key: "staff-heartbeats",
    label: "Activity heartbeats (break nudges)",
    model: "activityHeartbeat",
    principals: STAFF,
    purpose: "Break nudges only. Kept 7 days, never reported to managers (ADR-006).",
    fields: [f("at", "At", "B"), f("source", "Source", "B")],
    erasure: { kind: "keep", reason: "Removed automatically after 7 days by the coach retention job (ADR-006)." },
    rows: async (db, s) => (staffOf(s) ? finder(db, "activityHeartbeat").findMany({ where: { userId: staffOf(s)!.user.id }, orderBy: { at: "asc" }, take: 5000 }) : []),
  },
];

export const datasetsFor = (t: PrincipalType) => DATASETS.filter((d) => d.principals.includes(t));

/** Systems outside Firm OS that also hold the client's data. Firm OS never deletes in them. */
export const EXTERNAL_SYSTEMS = [
  {
    key: "turia",
    label: "Turia (practice.turia.in)",
    detail: "Turia is the firm's record of clients, services and time. Firm OS never changes or deletes Turia records. After the hold date, a partner asks the Turia admin to archive or anonymise the client there.",
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

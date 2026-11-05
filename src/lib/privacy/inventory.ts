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
import { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import type { DutyId, PrincipalType } from "./policy";
import { ERASED_TOKEN, clientNeedles, codeNeedle, namePartNeedles, panNeedle, phoneNeedle, phraseNeedle, scrubColumns, scrubberFor, type Needle, type Scrubber } from "./scrub";

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
  | {
      kind: "anonymise";
      /** Duties that put the item on legal hold instead: every duty in force ("client"), or only these. */
      duties: "client" | readonly DutyId[];
      /** Column values the UPDATE writes. `s` replaces the person's identifiers in text and JSON. */
      set: (row: Row, s: Scrubber) => Row;
      applies?: (row: Row, s: Scrubber) => boolean;
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
  derived?: (row: Row) => Row;
  erasure: ErasureRule;
  rows(db: PrivacyReadDb, scope: Scope): Promise<Row[]>;
}

type Finder = { findMany(args: { where: Row; select?: Row; orderBy?: Row; take?: number }): Promise<Row[]> };
const finder = (db: PrivacyReadDb, model: ModelName) => db[model] as unknown as Finder;

const ERASED = ERASED_TOKEN;
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

// ------------------------------------------------------------------ residue (erasure only)

/**
 * The person's needles (scrub.ts): a client principal gets the client master's names and
 * identifiers; a company's contact person only their own name, email and phone (the company is not
 * a data principal); staff their name and email.
 */
export function needlesFor(s: Scope): Needle[] {
  if (s.kind === "staff") return [phraseNeedle(s.user.name, "name"), codeNeedle(s.user.email)].filter((n): n is Needle => n !== null);
  // A client person's filings are theirs too: acknowledgement numbers (ARN / SRN / ITR ack) found in notes.
  if (s.principalType === "client-person") return [...clientNeedles(s.client), ...s.jobTasks.map((j) => (j.ackRef ? codeNeedle(j.ackRef) : null)).filter((n): n is Needle => n !== null)];
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
  const name = String(s.client.name);
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
    certificates: await finder(db, "certificateIssue").findMany({ where: { clientName: name }, select: { id: true } }),
    letters: await finder(db, "engagementLetter").findMany({ where: { clientName: name }, select: { id: true } }),
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
];

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

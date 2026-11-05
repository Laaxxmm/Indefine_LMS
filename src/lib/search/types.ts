// Shared types for Firm OS search (src/lib/search). Pure module: no Prisma, no fetch, safe to
// import from client components (the /search panel and the command palette).

/** Entity types a person can search, in the order groups are shown on ties. */
export const SEARCH_TYPES = ["client", "job", "run", "deliverable", "draft", "onboarding", "client-job", "document"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Group headings and filter chips. */
export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  client: "Clients",
  job: "Firm OS jobs",
  run: "Agent runs",
  deliverable: "Deliverables",
  draft: "Comms drafts",
  onboarding: "Onboarding",
  "client-job": "Client jobs",
  document: "Client documents",
};

/** The type badge on one result. */
export const SEARCH_TYPE_SINGULAR: Record<SearchType, string> = {
  client: "Client",
  job: "Firm OS job",
  run: "Agent run",
  deliverable: "Deliverable",
  draft: "Comms draft",
  onboarding: "Onboarding",
  "client-job": "Client job",
  document: "Client document",
};

export const isSearchType = (v: unknown): v is SearchType => typeof v === "string" && (SEARCH_TYPES as readonly string[]).includes(v);

/** 0 = exact code / ID / name, 1 = starts with the query, 2 = contains it. Lower sorts first. */
export type MatchRank = 0 | 1 | 2;

export type SearchHit = {
  type: SearchType;
  /** The entity's own id (Client.id, JobTask.id, AgentRun.id, ...). */
  id: string;
  /** Display label, identifiers inside it masked. */
  label: string;
  /** One short line of context (code, period, state, date). Never a draft body or a full identifier. */
  context: string;
  /** The page that opens the entity. Checked by `npm run verify:ui-links`. */
  href: string;
  rank: MatchRank;
  /** ISO timestamp of the entity's last change; "recent first" on equal rank. */
  at: string;
  /** Identifier searches only: which identifier matched, masked ("PAN XXXXXX234A"). */
  matched?: string;
  /** Identifier searches only: ids a privacy request can point at (Client.id, FirmClient.id). */
  refs?: { clientId?: string; firmClientId?: string | null };
};

export type SearchGroup = { type: SearchType; label: string; hits: SearchHit[]; /** More matched than are shown. */ more: boolean };

export type IdentifierKind = "pan" | "gstin" | "phone" | "email";

export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = { pan: "PAN", gstin: "GSTIN", phone: "phone", email: "email" };

/** What GET/POST /api/firm-os/search returns on success. */
export type SearchResponse = {
  query: string;
  /** text = names, codes and titles; identifier = exact PAN/GSTIN/phone/email; partial = part of an identifier (codes only). */
  mode: "text" | "identifier" | "partial" | "unsupported";
  identifier: { kind: IdentifierKind; masked: string } | null;
  groups: SearchGroup[];
  total: number;
  /** A plain sentence to show instead of (or above) results, e.g. why a partial PAN finds nothing. */
  message: string | null;
  /** The types this person may search (filter chips). */
  types: SearchType[];
};

/** Per-type and overall caps (ILIKE scans stay small; see docs in service.ts). */
export const PER_TYPE_LIMIT = 10;
export const SINGLE_TYPE_LIMIT = 25;
export const TOTAL_LIMIT = 50;

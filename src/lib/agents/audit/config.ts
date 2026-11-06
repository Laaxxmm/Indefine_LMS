// Audit Assist: every threshold, grouping and phrase list as data, each with a `verify` note for
// the engagement partner. Amounts in paise (₹1 crore = 1,00,00,000 rupees = 1_000_000_000 paise).
import { SMALL_COMPANY_LIMITS } from "@/lib/agents/roc/data";

const CRORE = 1_00_00_000_00; // paise

/** Every deliverable carries this label; the agent never prepares the audit report. */
export const DRAFT_FOR_PARTNER = "Draft for engagement partner";

/** Materiality (SA 320). */
export const MATERIALITY = {
  /** Overall materiality = this many basis points of revenue (1%). */
  revenueBps: 100,
  /** Fallback when the TB shows no revenue: basis points of total debits (0.5%). */
  fallbackTotalDebitsBps: 50,
  /** Performance materiality = this percent of overall materiality. */
  performancePercent: 75,
  verify:
    "Overall materiality 1% of revenue (fallback 0.5% of TB total debits), performance materiality 75%, rounded down to the rupee. These are firm SOP defaults under SA 320; the engagement partner sets materiality per engagement (entity.json `materiality` overrides).",
} as const;

/** Variance vs prior year that needs an explanation (SA 520 analytical procedures). */
export const VARIANCE = {
  /** Absolute variance at least performance materiality AND at least this percent of the prior year. */
  minPercent: 20,
  verify: "A lead-schedule variance needs an explanation when it is ≥ performance materiality and ≥ 20% of the prior year (or the prior year is nil). Partner to confirm.",
} as const;

/** Sampling (SA 530). */
export const SAMPLING = {
  /** SOP minimum items per sample (a smaller population is tested 100%). */
  minSampleSize: 25,
  /** MUS sample size = ceil(population value × confidence factor ÷ tolerable misstatement). */
  confidenceFactorTenths: 30, // 3.0 = 95% confidence, zero expected misstatements (Poisson)
  defaultMethod: "mus" as "mus" | "random",
  verify:
    "SOP minimum sample 25 items; MUS sample size uses confidence factor 3.0 (95% confidence, no expected misstatement) with tolerable misstatement = performance materiality. Partner to confirm against the firm's audit manual.",
} as const;

/**
 * CARO 2020 applicability (Companies (Auditor's Report) Order, 2020, para 1(2)).
 * Excluded: banking, insurance, section 8, OPC, small company, and a private company that is not
 * a holding or subsidiary of a public company and meets ALL three limits below.
 */
export const CARO = {
  privateExemption: {
    paidUpPlusReservesMaxPaise: 1 * CRORE,
    borrowingsMaxPaise: 1 * CRORE,
    revenueMaxPaise: 10 * CRORE,
  },
  /**
   * s.2(85) small company: the verification-gated table shared with the ROC agent (one source of
   * truth, src/lib/agents/roc/data.ts). Only `verified` entries are applied; a later unverified
   * entry is tested and reported (audit.caro-small-company-pending-verification), never applied.
   */
  smallCompany: SMALL_COMPANY_LIMITS,
  /** Clause (ii)(b): working-capital limits sanctioned above this. */
  workingCapitalLimitPaise: 5 * CRORE,
  verify:
    "CARO 2020 private-company exemption: paid-up capital + reserves ≤ ₹1 crore (balance-sheet date), borrowings from banks/FIs ≤ ₹1 crore at any time in the year, total revenue (Schedule III, incl. discontinuing operations) ≤ ₹10 crore, and not a holding/subsidiary of a public company. Small company (s.2(85)): the limits APPLIED are the verified ones on record — paid-up ≤ ₹4 crore and turnover of the preceding FY ≤ ₹40 crore (Companies (Specification of Definitions Details) Amendment Rules, 2022). PARTNER TO VERIFY: a reported amendment raising them to ₹10 crore / ₹100 crore (effective date taken as 1 Dec 2025) is held as unverified data and NOT applied; where it would change CARO applicability the agent raises audit.caro-small-company-pending-verification. Confirm the notification and which limits govern the year audited. Clause (ii)(b) working-capital threshold ₹5 crore.",
} as const;

/** s.138 internal audit (Companies (Accounts) Rules, 2014, rule 13) — CARO clause (xiv). */
export const INTERNAL_AUDIT = {
  unlistedPublic: { paidUpMinPaise: 50 * CRORE, turnoverMinPaise: 200 * CRORE, borrowingsMinPaise: 100 * CRORE },
  private: { turnoverMinPaise: 200 * CRORE, borrowingsMinPaise: 100 * CRORE },
  verify: "Internal audit (s.138, rule 13): listed; unlisted public with paid-up ≥ ₹50 cr or turnover ≥ ₹200 cr or borrowings ≥ ₹100 cr (or deposits ≥ ₹25 cr — not modelled); private with turnover ≥ ₹200 cr or borrowings ≥ ₹100 cr. Verify current limits.",
} as const;

/**
 * A grouping pattern with conditions: `sign` limits it to a debit (net ≥ 0) or credit (net < 0)
 * balance — a clearing account is an asset or a liability by its balance at the date — and `verify`
 * is the note for the engagement partner (every mapping added after v1 carries one; the lead-tie
 * check lists the notes of the mappings a run used).
 */
export type GroupRule = { pattern: string; sign?: "dr" | "cr"; verify: string };

/**
 * Lead-schedule grouping map: TB group (Tally primary group / Zoho account type) → lead area.
 * First matching area wins, so the order matters (liabilities before assets, revenue before income).
 * `side` is the natural balance: lead schedules show Dr as positive and Cr as negative.
 */
export type LeadArea = { wp: string; name: string; side: "dr" | "cr"; groups: (string | GroupRule)[]; ledgers?: string[] };

const SCHEDULE_III = "partner to confirm Schedule III grouping";
/** Zoho Books standard account types (anchored: the whole group text), audit round 2. */
const zoho = (pattern: string, note: string, sign?: "dr" | "cr"): GroupRule => ({ pattern, ...(sign ? { sign } : {}), verify: `${note} — ${SCHEDULE_III}.` });

export const LEAD_AREAS: LeadArea[] = [
  { wp: "L-A", name: "Share capital and reserves", side: "cr", groups: ["capital account", "share capital", "reserves", "surplus", "equity", "partners"] },
  // "^long[- ]term liabilit": Zoho account type "Long Term Liability" (term loans) — before L-D's catch-all "liabilit".
  { wp: "L-B", name: "Borrowings", side: "cr", groups: ["loans \\(liability\\)", "secured loans", "unsecured loans", "borrowings", "bank od", "cash credit", "^long[- ]term liabilit"] },
  { wp: "L-C", name: "Trade payables", side: "cr", groups: ["sundry creditors", "trade payables", "accounts payable"] },
  // Deferred tax (Schedule III: non-current, shown net). Before L-D, whose catch-all "liabilit" took "Deferred Tax Liability".
  { wp: "L-O", name: "Deferred tax assets (net)", side: "dr", groups: [zoho("^deferred tax assets?$", "Zoho \"Deferred Tax Asset\" → Deferred tax assets (net), non-current")] },
  { wp: "L-P", name: "Deferred tax liabilities (net)", side: "cr", groups: [zoho("^deferred tax liabilit(y|ies)$", "Zoho \"Deferred Tax Liability\" → Deferred tax liabilities (net), non-current (it fell to L-D before)")] },
  // Zoho account type "Non Current Liability" (Schedule III non-current: other long-term liabilities and
  // long-term provisions). Before L-D, whose catch-all "liabilit" put it in current liabilities.
  {
    wp: "L-Q",
    name: "Other non-current liabilities and long-term provisions",
    side: "cr",
    groups: [zoho("^non[- ]?current liabilit(y|ies)$", "Zoho \"Non Current Liability\" → other long-term liabilities and long-term provisions, non-current (it fell to L-D, current liabilities, before; long-term borrowings belong in L-B)")],
  },
  {
    wp: "L-D",
    name: "Other current liabilities and provisions",
    side: "cr",
    groups: [
      "current liabilities",
      "provisions",
      "duties (&|and) taxes",
      "other liabilit",
      "liabilit",
      zoho("^output tax$", "Zoho \"Output Tax\" (GST payable) → other current liabilities (duties and taxes)"),
      zoho("^overseas tax payable$", "Zoho \"Overseas Tax Payable\" (tax collected for a foreign tax authority) → other current liabilities (duties and taxes payable); it was unmapped and blocked before"),
      zoho("^credit card$", "Zoho \"Credit Card\" → other current liabilities (short-term borrowings if the card is a bank credit facility the entity draws on)"),
      zoho("^payment clearing$", "Zoho \"Payment Clearing\" with a credit balance → other current liabilities (a debit balance goes to L-J)", "cr"),
    ],
  },
  { wp: "L-E", name: "Property, plant and equipment and intangibles", side: "dr", groups: ["fixed assets", "property", "plant", "intangible", "capital work", zoho("^fixed asset$", "Zoho \"Fixed Asset\" (singular) → property, plant and equipment")] },
  { wp: "L-F", name: "Investments", side: "dr", groups: ["investments"] },
  { wp: "L-G", name: "Inventories", side: "dr", groups: ["stock[- ]in[- ]hand", "inventor", "closing stock", zoho("^stock$", "Zoho \"Stock\" → inventories")] },
  { wp: "L-H", name: "Trade receivables", side: "dr", groups: ["sundry debtors", "trade receivables", "accounts receivable"] },
  { wp: "L-I", name: "Cash and bank balances", side: "dr", groups: ["cash[- ]in[- ]hand", "bank accounts", "^bank$", "^cash$"] },
  // Tally primary group "Misc. Expenses (ASSET)" (expenditure not written off — an asset, before L-N's "expenses") and
  // Zoho account type "Other Current Asset" (singular, which "current assets" does not match). L-J also holds the
  // other non-current assets ("other assets", "non-current assets" already land here).
  {
    wp: "L-J",
    name: "Loans, advances and other assets",
    side: "dr",
    groups: [
      "loans (&|and) advances",
      "deposits \\(asset\\)",
      "current assets",
      "other assets",
      "prepaid",
      "advances",
      "^misc(\\.|ellaneous)? expenses \\(asset\\)$",
      "^other current asset$",
      zoho("^other asset$", "Zoho \"Other Asset\" → other non-current assets (long-term loans and advances where it is a loan or deposit)"),
      zoho("^non[- ]?current asset$", "Zoho \"Non Current Asset\" → other non-current assets"),
      zoho("^input tax$", "Zoho \"Input Tax\" (GST input credit) → other current assets (balances with government authorities)"),
      zoho("^payment clearing$", "Zoho \"Payment Clearing\" with a debit balance → other current assets (a credit balance goes to L-D)", "dr"),
    ],
  },
  { wp: "L-K", name: "Revenue from operations", side: "cr", groups: ["sales accounts", "revenue", "^sales$", "^direct incomes", "operating income"] },
  { wp: "L-L", name: "Other income", side: "cr", groups: ["indirect incomes", "other income", "^income$"] },
  { wp: "L-M", name: "Purchases and direct costs", side: "dr", groups: ["purchase accounts", "^direct expenses", "cost of goods", "cost of sales", "purchases"] },
  { wp: "L-N", name: "Other expenses", side: "dr", groups: ["indirect expenses", "expenses", "expense"] },
];
export const LEAD_AREAS_VERIFY = "Lead areas follow Schedule III headings mapped from Tally primary groups / Zoho account types. Suspense or custom groups are left unmapped on purpose (they block until mapped). Partner to extend the map for client-specific groups.";

/** Every grouping note in the map (one per conditional pattern), for review. */
export const LEAD_GROUPING_NOTES: { wp: string; pattern: string; verify: string }[] = LEAD_AREAS.flatMap((a) =>
  a.groups.filter((g): g is GroupRule => typeof g !== "string").map((g) => ({ wp: a.wp, pattern: g.pattern, verify: g.verify })),
);

/** SA-aligned working-paper index (data). Lead schedules are inserted under section D. */
export const WP_INDEX: { ref: string; section: string; sa: string; description: string }[] = [
  { ref: "A1", section: "A Engagement and planning", sa: "SA 210", description: "Terms of engagement (engagement letter)" },
  { ref: "A2", section: "A Engagement and planning", sa: "SA 220", description: "Quality management for the engagement; independence" },
  { ref: "A3", section: "A Engagement and planning", sa: "SA 300", description: "Audit strategy and plan" },
  { ref: "A4", section: "A Engagement and planning", sa: "SA 315", description: "Understanding the entity; risk assessment" },
  { ref: "A5", section: "A Engagement and planning", sa: "SA 320", description: "Materiality and performance materiality" },
  { ref: "A6", section: "A Engagement and planning", sa: "SA 330", description: "Responses to assessed risks" },
  { ref: "B1", section: "B Fraud, laws and regulations", sa: "SA 240", description: "Fraud risk assessment and journal-entry testing" },
  { ref: "B2", section: "B Fraud, laws and regulations", sa: "SA 250", description: "Compliance with laws and regulations" },
  { ref: "C1", section: "C Communication", sa: "SA 260", description: "Communication with those charged with governance" },
  { ref: "C2", section: "C Communication", sa: "SA 265", description: "Deficiencies in internal control" },
  { ref: "D1", section: "D Audit evidence", sa: "SA 500", description: "Audit evidence — lead schedules (see L- references)" },
  { ref: "D2", section: "D Audit evidence", sa: "SA 501", description: "Inventory attendance, litigation and claims" },
  { ref: "D3", section: "D Audit evidence", sa: "SA 505", description: "External confirmations (banks, debtors, creditors)" },
  { ref: "D4", section: "D Audit evidence", sa: "SA 520", description: "Analytical procedures — variance vs prior year" },
  { ref: "D5", section: "D Audit evidence", sa: "SA 530", description: "Audit sampling — selections (seed recorded)" },
  { ref: "E1", section: "E Estimates and related parties", sa: "SA 540", description: "Accounting estimates" },
  { ref: "E2", section: "E Estimates and related parties", sa: "SA 550", description: "Related parties" },
  { ref: "F1", section: "F Completion", sa: "SA 560", description: "Subsequent events" },
  { ref: "F2", section: "F Completion", sa: "SA 570", description: "Going concern" },
  { ref: "F3", section: "F Completion", sa: "SA 580", description: "Written representations" },
  { ref: "F4", section: "F Completion", sa: "SA 230", description: "Audit documentation and file assembly" },
  { ref: "G1", section: "G Reporting", sa: "SA 700 series", description: "Reserved for the engagement partner — not prepared by the agent" },
  { ref: "G2", section: "G Reporting", sa: "CARO 2020", description: "CARO 2020 clause checklist (applicability only)" },
];

/**
 * Wording that expresses (or reads as) an audit opinion. No agent output may contain it, except
 * the CARO clause titles column (statutory wording). Matched case-insensitively on normalised
 * whitespace. Partner to extend.
 */
export const OPINION_PHRASES = [
  "true and fair",
  "in our opinion",
  "we report that",
  "we certify",
  "we further report",
  "presents fairly",
  "present fairly",
  "give a true",
  "gives a true",
  "unqualified opinion",
  "unmodified opinion",
  "qualified opinion",
  "adverse opinion",
  "disclaimer of opinion",
  "basis for opinion",
  "we are of the opinion",
  "according to the information and explanations given to us",
  "to the best of our information and according to the explanations given to us",
] as const;
export const OPINION_VERIFY = "Opinion-language list (SA 700/705/706 report wording). Partner to extend.";

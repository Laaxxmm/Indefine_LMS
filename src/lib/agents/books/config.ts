// Books Close: every threshold, date rule and name list as data. Rule thresholds are also carried
// in the SOP pack (rule params) so a partner can change them by publishing a new pack version;
// the values here are the v1.0.0 defaults. Each entry has a `verify` note: a CA partner confirms
// it before go-live (orchestrator: "every threshold/date in data with a verify: note").

/** Bank reconciliation matching (used by the matcher; not a rule param because extract runs before rules). */
export const BANK_MATCH = {
  /** Pass 2 (amount + date): statement and ledger dates may differ by at most this many days. */
  windowDays: 5,
  /** Pass 1 (reference + amount): a wider window, because the reference already ties the pair. */
  refWindowDays: 31,
  verify:
    "Date windows for automatic matching: 5 days for amount+date, 31 days when the cheque/UTR reference also agrees. Partner to confirm these suit the firm's clients (cheque clearing is T+1 under CTS; NEFT/RTGS same day).",
} as const;

export const BOOKS_THRESHOLDS = {
  /** An unreconciled bank item older than this many days at period end is flagged. */
  staleDays: 30,
  staleVerify: "Unreconciled bank items are flagged when older than 30 days at month end. Partner to confirm N (cheques stay valid 3 months — RBI).",
  /** GST ledger vs return: differences up to this many paise per head are rounding. */
  gstTolerancePaise: 100,
  gstVerify: "GST ledger vs filed return: differences of ₹1 or less per tax head are treated as rounding. Partner to confirm.",
  /** Expense spike: current month above prior month by both a percentage and an absolute amount. */
  spikePercent: 50,
  spikeMinIncreasePaise: 50_000_00,
  spikeVerify:
    "Expense spike = a ledger up by more than 50% AND by at least ₹50,000 against the prior month. Assumes both trial balances are for the month (period), not year-to-date. Partner to confirm.",
  /** Suggestions below this confidence are listed for a closer look. */
  lowConfidence: 0.75,
  lowConfidenceVerify: "Expense-classification suggestions under 0.75 confidence are called out. Matches ROUTER_MIN_CONF; partner to confirm.",
} as const;

/**
 * TDS deposit due dates (Income-tax Rules 1962, rule 30(2), non-government deductor):
 * 7th of the following month; for deductions in March, 30 April. Book-entry (government) and
 * s.194-IA/IB/M challan-cum-statement deductions have other dates and are not modelled.
 */
export const TDS_DUE = {
  dayOfNextMonth: 7,
  march: { month: 4, day: 30 },
  verify:
    "TDS deposit due: 7th of next month; March deductions by 30 April (rule 30(2), IT Rules 1962). Confirm the corresponding rule under the Income-tax Act, 2025 for tax year 2026-27 onwards, and that no deductor here is a government office or uses 194-IA/IB/M challan-cum-statements.",
} as const;

/** Ledger / group names (case-insensitive regex sources). */
export const BOOKS_NAMES = {
  suspense: ["suspense", "unidentified", "unallocated", "unreconciled", "difference in opening"],
  cash: { ledger: ["^cash$", "^cash[ -]in[ -]hand", "^petty cash", "^cash a/?c", "^cash account"], group: ["cash[ -]in[ -]hand"] },
  expense: { group: ["indirect expenses", "direct expenses", "^expenses?$", "operating expenses", "administrative expenses", "other expenses", "cost of goods sold"] },
  verify: "Suspense, cash and expense ledgers are recognised by name/group patterns (Tally primary groups and Zoho account types). Partner to add client-specific ledger names.",
} as const;

/** Default chart heads offered to the classifier when the trial balance has no expense ledgers. */
export const DEFAULT_EXPENSE_HEADS = [
  "Bank Charges",
  "Rent",
  "Salaries and Wages",
  "Professional Fees",
  "Telephone and Internet",
  "Electricity",
  "Travelling and Conveyance",
  "Printing and Stationery",
  "Repairs and Maintenance",
  "Insurance",
  "Office Expenses",
  "Purchases",
  "Freight and Cartage",
  "Advertisement",
  "Interest",
] as const;

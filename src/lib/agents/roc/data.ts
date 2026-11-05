// ROC rates, thresholds and dates — DATA ONLY. Every entry carries a `verify` note naming the
// provision a partner must re-check; amounts are integer paise. The AOC-4 / MGT-7 / ADT-1 /
// DIR-3 KYC / MSME-1 due dates are NOT here: they come from the shared statutory calendar
// (src/lib/agents/core/calendar-defaults.ts) so there is one source of truth per date.
//
// Versioned entries carry `effectiveFrom` (a day key); the entry in force on the company's
// financial-year end applies. A new notification = a new entry, never an edit of an old one.

export type Versioned<T> = T & { effectiveFrom: string; verify: string };

const CRORE = 1_00_00_000_00; // ₹1 crore in paise
const LAKH = 1_00_000_00; // ₹1 lakh in paise

/** s.2(85) small company: paid-up capital AND turnover (immediately preceding FY) must not exceed these. */
export const SMALL_COMPANY_LIMITS: Versioned<{ paidUpMaxPaise: number; turnoverMaxPaise: number }>[] = [
  {
    effectiveFrom: "2022-09-15",
    paidUpMaxPaise: 4 * CRORE,
    turnoverMaxPaise: 40 * CRORE,
    verify: "Companies (Specification of Definitions Details) Amendment Rules, 2022: paid-up ≤ ₹4 crore and turnover ≤ ₹40 crore.",
  },
  {
    effectiveFrom: "2025-12-01",
    paidUpMaxPaise: 10 * CRORE,
    turnoverMaxPaise: 100 * CRORE,
    verify:
      "PARTNER TO VERIFY: MCA amendment raising the small-company limits to paid-up ≤ ₹10 crore and turnover ≤ ₹100 crore (effective date taken as 1 Dec 2025). Confirm the G.S.R. number and date before relying on MGT-7A for FY 2025-26.",
  },
];

/** s.135(1) CSR: any ONE of these ("or more") in the immediately preceding FY makes CSR apply. */
export const CSR_THRESHOLDS: Versioned<{ netWorthPaise: number; turnoverPaise: number; netProfitPaise: number; spendPercent: number }>[] = [
  {
    effectiveFrom: "2014-04-01",
    netWorthPaise: 500 * CRORE,
    turnoverPaise: 1000 * CRORE,
    netProfitPaise: 5 * CRORE,
    spendPercent: 2,
    verify:
      "Companies Act s.135(1) and (5): net worth ₹500 crore or more, turnover ₹1,000 crore or more, or net profit ₹5 crore or more; spend 2% of the average net profit (s.198) of the three immediately preceding FYs. Net profit is read as profit before tax — verify the s.198 adjustments.",
  },
];

/** s.96: AGM within 6 months of FY end (first AGM: 9 months); ROC may extend by up to 3 months; gap ≤ 15 months. */
export const AGM_RULES: Versioned<{ monthsAfterFyEnd: number; firstAgmMonths: number; maxGapMonths: number; maxExtensionMonths: number }> = {
  effectiveFrom: "2014-04-01",
  monthsAfterFyEnd: 6,
  firstAgmMonths: 9,
  maxGapMonths: 15,
  maxExtensionMonths: 3,
  verify: "Companies Act s.96(1): within six months of the FY end (first AGM nine months), not more than 15 months between AGMs; extension by the Registrar up to three months (not for the first AGM). OPCs need no AGM.",
};

/** OPC: no AGM; AOC-4 within 180 days of the FY end (s.137(1) proviso); MGT-7A counted from the date the AGM would have been due. */
export const OPC_RULES: Versioned<{ aoc4DaysFromFyEnd: number }> = {
  effectiveFrom: "2014-04-01",
  aoc4DaysFromFyEnd: 180,
  verify: "Companies Act s.137(1) proviso: an OPC files its financial statements within 180 days from the close of the FY (31 Mar → 27 Sep).",
};

/** Normal filing fee by nominal (authorised) share capital: [upToPaise exclusive, feePaise]. */
export const NORMAL_FEE_SLABS: Versioned<{ slabs: { belowPaise: number | null; feePaise: number }[]; noShareCapitalFeePaise: number }> = {
  effectiveFrom: "2014-04-01",
  slabs: [
    { belowPaise: 1 * LAKH, feePaise: 200_00 },
    { belowPaise: 5 * LAKH, feePaise: 300_00 },
    { belowPaise: 25 * LAKH, feePaise: 400_00 },
    { belowPaise: 1 * CRORE, feePaise: 500_00 },
    { belowPaise: null, feePaise: 600_00 },
  ],
  noShareCapitalFeePaise: 200_00,
  verify: "Companies (Registration Offices and Fees) Rules, 2014, Annexure, Table of fees for e-forms: ₹200 / 300 / 400 / 500 / 600 by nominal share capital. Re-check for later amendments.",
};

/** Additional fee: AOC-4 / MGT-7(A) at a flat amount per day of delay; other forms (ADT-1) as a multiple of the normal fee. */
export const ADDITIONAL_FEE: Versioned<{
  perDayFormsPaise: number;
  multiples: { maxDays: number | null; times: number }[];
  dirKycLateFeePaise: number;
}> = {
  effectiveFrom: "2018-07-01",
  perDayFormsPaise: 100_00,
  multiples: [
    { maxDays: 30, times: 2 },
    { maxDays: 60, times: 4 },
    { maxDays: 90, times: 6 },
    { maxDays: 180, times: 10 },
    { maxDays: null, times: 12 },
  ],
  dirKycLateFeePaise: 5_000_00,
  verify:
    "Companies (Registration Offices and Fees) Amendment Rules, 2018 (w.e.f. 1 Jul 2018): ₹100 per day for AOC-4 / MGT-7 (s.137 / s.92); other forms 2× (≤30 days), 4× (≤60), 6× (≤90), 10× (≤180), 12× (>180) of the normal fee; DIR-3 KYC after the due date ₹5,000. PARTNER TO VERIFY current amounts (MCA has proposed reduced fees for small companies / OPCs).",
};

/** DIR-3 KYC frequency: a director's KYC counts if completed within this many years ending with the current window. */
export const DIR_KYC: Versioned<{ frequencyYears: number }> = {
  effectiveFrom: "2018-07-10",
  frequencyYears: 1,
  verify: "Companies (Appointment and Qualification of Directors) Rules, rule 12A: annual KYC by 30 September after the FY. PARTNER TO VERIFY — MCA has amended the KYC frequency; change frequencyYears in a new pack if KYC is now triennial.",
};

/** s.139 auditor term and rotation (rule 5 of the Companies (Audit and Auditors) Rules, 2014). */
export const AUDITOR_RULES: Versioned<{
  termYears: number;
  rotation: { individualMaxYears: number; firmMaxYears: number; unlistedPublicPaidUpPaise: number; privatePaidUpPaise: number; borrowingsPaise: number };
}> = {
  effectiveFrom: "2014-04-01",
  termYears: 5,
  rotation: {
    individualMaxYears: 5,
    firmMaxYears: 10,
    unlistedPublicPaidUpPaise: 10 * CRORE,
    privatePaidUpPaise: 50 * CRORE,
    borrowingsPaise: 50 * CRORE,
  },
  verify:
    "Companies Act s.139(1)-(2) and rule 5: a term of five consecutive years (first AGM to sixth AGM); rotation for listed companies, unlisted public companies with paid-up ≥ ₹10 crore, private companies with paid-up ≥ ₹50 crore, and companies with borrowings ≥ ₹50 crore — individual one term (5 years), firm two terms (10 years). Borrowings here are all long + short-term borrowings in the balance sheet; verify the 'public borrowings' reading.",
};

/** MSME-1: half-yearly return of amounts due to micro / small suppliers outstanding more than 45 days. */
export const MSME1: Versioned<{ maxDays: number }> = {
  effectiveFrom: "2019-01-22",
  maxDays: 45,
  verify: "Specified Companies (Furnishing of information about payment to micro and small enterprise suppliers) Order, 2019: dues beyond 45 days (MSMED Act s.9/s.15); Apr–Sep by 31 Oct, Oct–Mar by 30 Apr.",
};

/** DPT-3: annual return of deposits / outstanding money not treated as deposits, by 30 June. */
export const DPT3: Versioned<{ dueMonthDay: string }> = {
  effectiveFrom: "2019-01-22",
  dueMonthDay: "06-30",
  verify: "Companies (Acceptance of Deposits) Rules, 2014, rule 16 and 16A: return as on 31 March by 30 June; government companies, banks, NBFCs and HFCs are exempt.",
};

/** Mistake-loop parameters (registered checks used only by approved MistakeLog rules). */
export const MIN_DIRECTORS: Versioned<{ private: number; public: number; opc: number }> = {
  effectiveFrom: "2014-04-01",
  private: 2,
  public: 3,
  opc: 1,
  verify: "Companies Act s.149(1): minimum three directors (public), two (private), one (OPC).",
};

/** The entry in force on `day` (latest effectiveFrom ≤ day). Throws when none applies. */
export function inForce<T extends { effectiveFrom: string }>(entries: readonly T[], day: string, what: string): T {
  const hit = [...entries].filter((e) => e.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!hit) throw new Error(`no ${what} in force on ${day}`);
  return hit;
}

/** All verify notes (for the deliverable's "Verify" sheet and the report). */
export function rocVerifyNotes(): { item: string; verify: string }[] {
  return [
    ...SMALL_COMPANY_LIMITS.map((v) => ({ item: `Small company limits from ${v.effectiveFrom}`, verify: v.verify })),
    ...CSR_THRESHOLDS.map((v) => ({ item: "CSR thresholds and spend", verify: v.verify })),
    { item: "AGM due date", verify: AGM_RULES.verify },
    { item: "OPC AOC-4 due date", verify: OPC_RULES.verify },
    { item: "Normal filing fee", verify: NORMAL_FEE_SLABS.verify },
    { item: "Additional fee", verify: ADDITIONAL_FEE.verify },
    { item: "DIR-3 KYC frequency", verify: DIR_KYC.verify },
    { item: "Auditor term and rotation", verify: AUDITOR_RULES.verify },
    { item: "MSME-1", verify: MSME1.verify },
    { item: "DPT-3", verify: DPT3.verify },
    { item: "Minimum directors", verify: MIN_DIRECTORS.verify },
  ];
}

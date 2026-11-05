// GST Prep — every rate, threshold and date the agent uses, as DATA with a `verify` note for a CA
// partner. Two homes:
//
//   1. GST_CONFIG (this file): values the deterministic computation needs (B2CL threshold, s.50
//      interest, late fee, due days, RCM rates, reconciliation tolerance, rule 37 days, the s.34(2)
//      credit-note time limit). The
//      framework's compute(extracted, input) receives no SopPack, so these are module data.
//      The default SopPack mirrors them in the params of rule `gst.pack-config`, and that rule
//      BLOCKS approval when the active pack and this module disagree (a partner changed a rate
//      in the pack without a code release, or the reverse), so the two can never drift silently.
//   2. Rule params in the SopPack (rules.ts → GST_CHECKLIST): thresholds only checks use (HSN
//      digits by AATO, e-invoice AATO, period-lock tolerance). A partner
//      changes those by publishing a new pack version; no code release is needed.
//
// Amounts are integer paise; rates are basis points (1800 = 18%). Dates are "MM-DD" or day numbers.
// Nothing here is legal advice; the active, partner-approved SopPack is the authority.

/** One AATO slab: applies when AATO ≤ uptoAatoPaise (null = no upper limit). */
export type AatoSlab<T> = { uptoAatoPaise: number | null } & T;

export const BLOCKED_CATEGORIES = {
  "motor-vehicle": "s.17(5)(a)/(aa)/(ab): motor vehicles for persons (≤ 13 seats), vessels, aircraft, their repair, insurance and servicing",
  "food-beverage": "s.17(5)(b)(i): food and beverages, outdoor catering",
  "beauty-health": "s.17(5)(b)(i): beauty treatment, health services, cosmetic and plastic surgery",
  "rent-a-cab-insurance": "s.17(5)(b)(i): leasing/renting/hiring of motor vehicles, vessels, aircraft; life and health insurance",
  "club-fitness": "s.17(5)(b)(ii): membership of a club, health and fitness centre",
  "employee-travel": "s.17(5)(b)(iii): travel benefits to employees on vacation (leave or home travel concession)",
  "works-contract-immovable": "s.17(5)(c)/(d): works contract or goods/services for construction of immovable property on own account (other than plant and machinery)",
  "composition-tax": "s.17(5)(e): goods or services on which composition tax is paid",
  "personal-consumption": "s.17(5)(g): goods or services used for personal consumption",
  "gifts-free-samples": "s.17(5)(h): goods lost, stolen, destroyed, written off, or disposed of by way of gift or free samples",
  "tax-demand": "s.17(5)(i): tax paid under s.74, s.129 or s.130",
} as const;
export type BlockedCategory = keyof typeof BLOCKED_CATEGORIES;
export const BLOCKED_CATEGORY_KEYS = Object.keys(BLOCKED_CATEGORIES) as [BlockedCategory, ...BlockedCategory[]];

/**
 * Services under reverse charge (s.9(3), Notification 13/2017-CT(Rate) as amended). rateBps is the
 * rate the draft applies when the books show no tax; forwardChargeRatesBps lists rates at which a
 * registered supplier may lawfully charge tax forward instead (GTA option).
 */
export const RCM_SERVICES = {
  legal: { label: "Legal services by an advocate or firm of advocates", rateBps: 1800, forwardChargeRatesBps: [] as number[] },
  gta: { label: "Goods transport agency (GTA) services", rateBps: 500, forwardChargeRatesBps: [1200, 1800] },
  security: { label: "Security services by a person other than a body corporate", rateBps: 1800, forwardChargeRatesBps: [] as number[] },
  director: { label: "Services of a director to the company or body corporate", rateBps: 1800, forwardChargeRatesBps: [] as number[] },
  sponsorship: { label: "Sponsorship services to a body corporate or partnership firm", rateBps: 1800, forwardChargeRatesBps: [] as number[] },
  "renting-unregistered": { label: "Renting of commercial immovable property by an unregistered person", rateBps: 1800, forwardChargeRatesBps: [] as number[] },
} as const;
export type RcmService = keyof typeof RCM_SERVICES;
export const RCM_SERVICE_KEYS = Object.keys(RCM_SERVICES) as [RcmService, ...RcmService[]];

export const GST_CONFIG = {
  /** GSTR-1 B2CL: inter-state B2C invoice with invoice value MORE THAN this goes invoice-wise. */
  b2clThresholdPaise: 1_00_000_00,
  /** s.50(1): interest on tax paid late, on the cash portion only (proviso), per annum. */
  interestRateBps: 1800,
  daysInYear: 365,
  lateFee: {
    /** s.47 as reduced: ₹25 CGST + ₹25 SGST per day (₹50 total) for a return with liability. */
    perDayPaise: 50_00,
    /** Nil return: ₹10 + ₹10 per day. */
    nilPerDayPaise: 20_00,
    /** Notification 19/2021-CT caps (CGST + SGST together) by AATO of the preceding FY. */
    caps: [
      { uptoAatoPaise: 1_50_00_000_00, capPaise: 2_000_00 },
      { uptoAatoPaise: 5_00_00_000_00, capPaise: 5_000_00 },
      { uptoAatoPaise: null, capPaise: 10_000_00 },
    ] as AatoSlab<{ capPaise: number }>[],
    nilCapPaise: 500_00,
  },
  due: {
    /** GSTR-3B monthly: 20th of the following month. */
    gstr3bMonthlyDay: 20,
    /** GSTR-3B QRMP: 22nd or 24th of the month after the quarter, by state. */
    qrmpDay22: 22,
    qrmpDay24: 24,
    /** States in the 22nd group (same list as core/calendar-defaults.ts QRMP_3B_22ND). */
    qrmpDay22States: ["22", "23", "24", "25", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37"],
  },
  /** 2B vs books: a difference strictly greater than this on taxable value or any tax head is a mismatch. */
  reconTolerancePaise: 100,
  /** Rule 37: ITC on an invoice unpaid for more than this many days from the invoice date is reversed. */
  rule37Days: 180,
  rcmRatesBps: Object.fromEntries(Object.entries(RCM_SERVICES).map(([k, v]) => [k, v.rateBps])) as Record<RcmService, number>,
  /**
   * s.34(2) as amended by Finance Act 2022: a credit note must be declared by 30 November after the
   * end of the FY of the original supply. A later note does not reduce outward liability in the
   * draft (owner-approved 2026-11-05; compute.ts). Also the default of rule gst.credit-note-time-limit.
   */
  creditNoteDeadlineMonthDay: "11-30",
} as const;

/**
 * GST rate slabs (bps) a line's rate is snapped to when the register gives no usable rate column
 * (rate derived from tax ÷ taxable value). Includes the 40% slab and the special 0.1% / 0.25% /
 * 1.5% / 3% / 6% rates.
 */
export const GST_RATE_SLABS_BPS = [0, 10, 25, 100, 150, 300, 500, 600, 1200, 1800, 2800, 4000] as const;

/** Rule-only thresholds (defaults for the SopPack rule params). */
export const GST_RULE_DEFAULTS = {
  /** Notification 78/2020-CT: HSN digits in GSTR-1 Table 12 by AATO of the preceding FY. */
  hsnSlabs: [
    { uptoAatoPaise: 5_00_00_000_00, minDigits: 4, b2cOptional: true },
    { uptoAatoPaise: null, minDigits: 6, b2cOptional: false },
  ] as AatoSlab<{ minDigits: number; b2cOptional: boolean }>[],
  /** Notification 10/2023-CT: e-invoicing for AATO above ₹5 crore in any FY from 2017-18 (from 1 Aug 2023). */
  einvoiceAatoPaise: 5_00_00_000_00,
  /** Previous period GSTR-1 vs GSTR-3B Table 3.1 liability: shortfall above this (per head) blocks. */
  periodLockTolerancePaise: 100,
  /** s.16(4) as amended: ITC of an FY can be taken up to 30 November of the next FY (mistake-promoted rule). */
  itcDeadlineMonthDay: "11-30",
} as const;

/** What a partner must verify, one line per value. Shown in the pack (params.verify) and the report. */
export const GST_VERIFY_NOTES: { key: string; value: string; verify: string }[] = [
  { key: "b2clThresholdPaise", value: "invoice value > ₹1,00,000", verify: "Notification 12/2024-CT (10 Jul 2024) reduced B2CL from ₹2,50,000 to ₹1,00,000 from 1 Aug 2024; confirm still current." },
  { key: "interestRateBps", value: "18% p.a. on the cash portion, 365-day year", verify: "s.50(1) and Notification 13/2017-CT; proviso (net cash liability) inserted retrospectively by Finance Act 2021; s.50(3) 24% on wrongly availed-and-utilised ITC is NOT estimated." },
  { key: "lateFee.perDayPaise", value: "₹50/day (₹25 CGST + ₹25 SGST)", verify: "s.47 with Notification 19/2021-CT; GSTR-3B late fee." },
  { key: "lateFee.nilPerDayPaise", value: "₹20/day (₹10 + ₹10), cap ₹500", verify: "Notification 19/2021-CT for nil returns." },
  { key: "lateFee.caps", value: "₹2,000 (AATO ≤ ₹1.5 cr) / ₹5,000 (≤ ₹5 cr) / ₹10,000 (> ₹5 cr)", verify: "Notification 19/2021-CT caps (CGST+SGST combined); IGST late fee not modelled." },
  { key: "due.gstr3bMonthlyDay", value: "20th of the next month", verify: "Rule 61(5); check one-off extensions for the period." },
  { key: "due.qrmp", value: "22nd (state group A, incl. Karnataka 29) / 24th (group B)", verify: "Notification 82/2020-CT state groups; same list as the calendar pack." },
  { key: "reconTolerancePaise", value: "₹1.00 (difference > ₹1 is a mismatch)", verify: "Firm SOP tolerance for 2B vs books per document and tax head." },
  { key: "rule37Days", value: "180 days from invoice date, unpaid as at period end", verify: "Rule 37 as substituted by Notification 26/2022-CT (reverse in the return after the 180 days lapse; re-avail on payment)." },
  { key: "rcmRatesBps.legal", value: "18%", verify: "Notification 13/2017-CT(Rate) entry 2; exemption for business entities with turnover up to the threshold in the preceding FY is NOT modelled." },
  { key: "rcmRatesBps.gta", value: "5% RCM; forward charge at 12% or 18% accepted", verify: "GTA rates after the 47th/56th Council decisions; confirm current FCM options." },
  { key: "rcmRatesBps.security", value: "18%", verify: "Notification 29/2018-CT(Rate)." },
  { key: "rcmRatesBps.director", value: "18%", verify: "Notification 13/2017-CT(Rate) entry 6." },
  { key: "rcmRatesBps.sponsorship", value: "18%", verify: "Notification 13/2017-CT(Rate) entry 4." },
  { key: "rcmRatesBps.renting-unregistered", value: "18%", verify: "Notification 09/2024-CT(Rate) from 10 Oct 2024 (renting of commercial property by unregistered person to registered person)." },
  { key: "hsnSlabs", value: "4 digits up to ₹5 cr AATO (B2C optional); 6 digits above", verify: "Notification 78/2020-CT; GSTR-1 Table 12 B2B/B2C split from 2025." },
  { key: "einvoiceAatoPaise", value: "AATO > ₹5 crore", verify: "Notification 10/2023-CT (from 1 Aug 2023); the 30-day IRN reporting limit for AATO ≥ ₹10 cr is not checked." },
  { key: "creditNoteDeadlineMonthDay", value: "30 November after the end of the FY", verify: "s.34(2) as amended by Finance Act 2022." },
  { key: "periodLockTolerancePaise", value: "₹1.00 per tax head", verify: "Firm SOP; DRC-01B (rule 88C) is triggered by GSTR-1 liability exceeding GSTR-3B beyond the notified limit." },
  { key: "itcDeadlineMonthDay", value: "30 November after the end of the FY", verify: "s.16(4) as amended by Finance Act 2022 (used by the mistake-promoted rule gst.itc-time-limit)." },
  { key: "rateSlabs", value: "0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40 %", verify: "Rate schedule after the 56th Council (Sept 2025) rationalisation; used only to snap a derived rate when the register has no rate column." },
  { key: "setoffOrder", value: "IGST credit first (IGST, then CGST/SGST); CGST → CGST then IGST; SGST → SGST then IGST (only after CGST credit is exhausted); cess → cess", verify: "s.49(5), s.49A, rule 88A and Circular 98/17/2019-GST." },
];

// ------------------------------------------------------------------ states

/** GST state codes → name and the short forms seen in exports. */
export const GST_STATES: Record<string, { name: string; alpha: string }> = {
  "01": { name: "Jammu and Kashmir", alpha: "JK" },
  "02": { name: "Himachal Pradesh", alpha: "HP" },
  "03": { name: "Punjab", alpha: "PB" },
  "04": { name: "Chandigarh", alpha: "CH" },
  "05": { name: "Uttarakhand", alpha: "UK" },
  "06": { name: "Haryana", alpha: "HR" },
  "07": { name: "Delhi", alpha: "DL" },
  "08": { name: "Rajasthan", alpha: "RJ" },
  "09": { name: "Uttar Pradesh", alpha: "UP" },
  "10": { name: "Bihar", alpha: "BR" },
  "11": { name: "Sikkim", alpha: "SK" },
  "12": { name: "Arunachal Pradesh", alpha: "AR" },
  "13": { name: "Nagaland", alpha: "NL" },
  "14": { name: "Manipur", alpha: "MN" },
  "15": { name: "Mizoram", alpha: "MZ" },
  "16": { name: "Tripura", alpha: "TR" },
  "17": { name: "Meghalaya", alpha: "ML" },
  "18": { name: "Assam", alpha: "AS" },
  "19": { name: "West Bengal", alpha: "WB" },
  "20": { name: "Jharkhand", alpha: "JH" },
  "21": { name: "Odisha", alpha: "OD" },
  "22": { name: "Chhattisgarh", alpha: "CG" },
  "23": { name: "Madhya Pradesh", alpha: "MP" },
  "24": { name: "Gujarat", alpha: "GJ" },
  "25": { name: "Daman and Diu", alpha: "DD" },
  "26": { name: "Dadra and Nagar Haveli and Daman and Diu", alpha: "DN" },
  "27": { name: "Maharashtra", alpha: "MH" },
  "29": { name: "Karnataka", alpha: "KA" },
  "30": { name: "Goa", alpha: "GA" },
  "31": { name: "Lakshadweep", alpha: "LD" },
  "32": { name: "Kerala", alpha: "KL" },
  "33": { name: "Tamil Nadu", alpha: "TN" },
  "34": { name: "Puducherry", alpha: "PY" },
  "35": { name: "Andaman and Nicobar Islands", alpha: "AN" },
  "36": { name: "Telangana", alpha: "TS" },
  "37": { name: "Andhra Pradesh", alpha: "AP" },
  "38": { name: "Ladakh", alpha: "LA" },
  "97": { name: "Other Territory", alpha: "OT" },
  "96": { name: "Foreign Country", alpha: "FC" },
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map<string, string>();
for (const [code, s] of Object.entries(GST_STATES)) {
  BY_NAME.set(squash(s.name), code);
  BY_NAME.set(squash(s.alpha), code);
}
BY_NAME.set("orissa", "21");
BY_NAME.set("tg", "36");
BY_NAME.set("pondicherry", "34");

/** "29", "29-Karnataka", "Karnataka (29)", "Karnataka", "KA" → "29"; unknown → null. */
export function stateCodeOf(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const num = /(?:^|\D)(\d{1,2})(?:\D|$)/.exec(t);
  if (num) {
    const c = num[1].padStart(2, "0");
    if (GST_STATES[c]) return c;
  }
  const words = t.replace(/\(.*?\)/g, " ").replace(/\d+/g, " ").replace(/[-–]/g, " ").trim();
  return BY_NAME.get(squash(words)) ?? null;
}

export function stateName(code: string | null): string {
  if (!code) return "";
  const s = GST_STATES[code];
  return s ? `${code}-${s.name}` : code;
}

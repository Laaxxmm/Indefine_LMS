// CARO 2020: whether the Order applies (para 1(2)) and a per-clause applicability checklist
// (para 3). Applicability only: the agent never answers a clause or expresses an opinion; the
// engagement partner concludes. Thresholds are data (config.ts CARO, INTERNAL_AUDIT). The
// small-company limits applied are only the partner-verified ones; limits awaiting verification
// are tested separately (caroPendingVerification) and never change the determination.
import { z } from "zod";
import { inForceVerified, type SmallCompanyLimits } from "@/lib/agents/roc/data";
import { CARO, INTERNAL_AUDIT } from "./config";

const amount = z.union([z.number(), z.string()]);

/** entity.json — amounts in rupees (number or "1,00,00,000.00" text). */
export const EntityProfileSchema = z
  .object({
    name: z.string().optional(),
    companyClass: z.enum(["private", "public", "opc", "section8", "banking", "insurance", "llp", "partnership", "proprietorship", "trust", "other-non-company"]),
    listed: z.boolean().optional(),
    holdingOrSubsidiaryOfPublic: z.boolean().optional(),
    holdingOrSubsidiary: z.boolean().optional(),
    specialAct: z.boolean().optional(),
    paidUpCapital: amount.optional(),
    reserves: amount.optional(),
    maxBorrowings: amount.optional(),
    turnover: amount.optional(),
    priorTurnover: amount.optional(),
    materiality: amount.optional(),
    consolidated: z.boolean().optional(),
    nidhi: z.boolean().optional(),
    nbfc: z.boolean().optional(),
    costRecordsApplicable: z.boolean().optional(),
    csrApplicable: z.boolean().optional(),
    internalAuditRequired: z.boolean().optional(),
    hasInventory: z.boolean().optional(),
  })
  .strict();

/** Normalised profile: amounts in paise (null = not given). */
export type EntityProfile = Omit<z.infer<typeof EntityProfileSchema>, "paidUpCapital" | "reserves" | "maxBorrowings" | "turnover" | "priorTurnover" | "materiality"> & {
  paidUpCapitalPaise: number | null;
  reservesPaise: number | null;
  maxBorrowingsPaise: number | null;
  turnoverPaise: number | null;
  priorTurnoverPaise: number | null;
  materialityPaise: number | null;
};

export type CaroStatus = "applicable" | "not-applicable" | "undetermined";
export type CaroDetermination = { status: CaroStatus; reasons: string[]; missing: string[] };

const NON_COMPANY = new Set(["llp", "partnership", "proprietorship", "trust", "other-non-company"]);
const crore = (p: number) => `₹${(p / 1_00_00_000_00).toLocaleString("en-IN")} crore`;

type TbFallback = { revenuePaise: number | null; priorRevenuePaise: number | null };

/** "2025-26" → "2026-03-31" (the balance-sheet date the limits are read at); null when unknown. */
export function fyEndOf(fy: string | null | undefined): string | null {
  const m = /^(\d{4})-\d{2}$/.exec(fy ?? "");
  return m ? `${Number(m[1]) + 1}-03-31` : null;
}

/**
 * `revenuePaise` / `priorRevenuePaise`: from the profile when given, else from the TB (revenue +
 * other income for the exemption test; prior revenue from operations for the small-company test).
 * `fyEnd`: the year audited (null = unknown → the latest verified limits). Only verified
 * small-company limits are applied.
 */
export function determineCaro(p: EntityProfile | null, tbFallback: TbFallback, fyEnd: string | null = null): CaroDetermination {
  return determineWith(p, tbFallback, inForceVerified(CARO.smallCompany, fyEnd, "small-company limit").applied);
}

type LimitsRef = { effectiveFrom: string; paidUpMaxPaise: number; turnoverMaxPaise: number; source: string };
/** One unverified limit set (and the CARO outcome under it) next to the verified set actually applied. */
export type CaroPendingVerification = LimitsRef & { status: CaroStatus; reasons: string[]; applied: LimitsRef };

/**
 * Small-company limits awaiting partner verification (in force for the year, later than the
 * verified limits applied) under which the CARO determination would come out differently.
 * Reported to the reviewer; never applied.
 */
export function caroPendingVerification(p: EntityProfile | null, tbFallback: TbFallback, fyEnd: string | null = null): CaroPendingVerification[] {
  const { applied, pending } = inForceVerified(CARO.smallCompany, fyEnd, "small-company limit");
  const base = determineWith(p, tbFallback, applied).status;
  const ref = (l: LimitsRef): LimitsRef => ({ effectiveFrom: l.effectiveFrom, paidUpMaxPaise: l.paidUpMaxPaise, turnoverMaxPaise: l.turnoverMaxPaise, source: l.source });
  return pending
    .map((l) => ({ l, d: determineWith(p, tbFallback, l) }))
    .filter(({ d }) => d.status !== base)
    .map(({ l, d }) => ({ ...ref(l), status: d.status, reasons: d.reasons, applied: ref(applied) }));
}

function determineWith(p: EntityProfile | null, tbFallback: TbFallback, sc: SmallCompanyLimits): CaroDetermination {
  if (!p) return { status: "undetermined", reasons: ["No entity profile (entity.json)"], missing: ["entity profile: company class, paid-up capital, reserves, borrowings, turnover"] };
  if (NON_COMPANY.has(p.companyClass)) return { status: "not-applicable", reasons: [`Not a company (${p.companyClass}); CARO 2020 applies to companies only`], missing: [] };
  const excluded: Record<string, string> = { banking: "banking company", insurance: "insurance company", section8: "company licensed under section 8", opc: "One Person Company" };
  if (excluded[p.companyClass]) return { status: "not-applicable", reasons: [`Excluded by para 1(2): ${excluded[p.companyClass]}`], missing: [] };
  if (p.companyClass === "public") return { status: "applicable", reasons: ["Public company: none of the para 1(2) exclusions applies"], missing: [] };

  // Private company: small company (s.2(85)), then the private-company exemption (para 1(2)(v)).
  const missing: string[] = [];
  const reasons: string[] = [];
  const priorTurnover = p.priorTurnoverPaise ?? tbFallback.priorRevenuePaise;
  let small: boolean | null;
  if (p.holdingOrSubsidiary === true || p.specialAct === true) small = false;
  else if (p.paidUpCapitalPaise !== null && p.paidUpCapitalPaise > sc.paidUpMaxPaise) small = false;
  else if (priorTurnover !== null && priorTurnover > sc.turnoverMaxPaise) small = false;
  else if (p.paidUpCapitalPaise === null || priorTurnover === null || p.holdingOrSubsidiary === undefined) {
    small = null;
    if (p.paidUpCapitalPaise === null) missing.push("paid-up capital");
    if (priorTurnover === null) missing.push("turnover of the preceding financial year (or the prior-year TB)");
    if (p.holdingOrSubsidiary === undefined) missing.push("whether the company is a holding or subsidiary company");
  } else small = true;
  if (small) return { status: "not-applicable", reasons: [`Small company: paid-up capital ≤ ${crore(sc.paidUpMaxPaise)} and preceding-year turnover ≤ ${crore(sc.turnoverMaxPaise)} (limits as tested), not a holding/subsidiary`], missing: [] };
  if (small === false) reasons.push("Not a small company");

  const ex = CARO.privateExemption;
  const revenue = p.turnoverPaise ?? tbFallback.revenuePaise;
  const capRes = p.paidUpCapitalPaise !== null && p.reservesPaise !== null ? p.paidUpCapitalPaise + p.reservesPaise : null;
  const fails: string[] = [];
  const unknown: string[] = [];
  if (p.holdingOrSubsidiaryOfPublic === true) fails.push("holding or subsidiary of a public company");
  else if (p.holdingOrSubsidiaryOfPublic === undefined) unknown.push("whether it is a holding or subsidiary of a public company");
  if (capRes === null) unknown.push("paid-up capital and reserves at the balance-sheet date");
  else if (capRes > ex.paidUpPlusReservesMaxPaise) fails.push(`paid-up capital + reserves above ${crore(ex.paidUpPlusReservesMaxPaise)}`);
  if (p.maxBorrowingsPaise === null) unknown.push("highest borrowings from banks/financial institutions during the year");
  else if (p.maxBorrowingsPaise > ex.borrowingsMaxPaise) fails.push(`borrowings above ${crore(ex.borrowingsMaxPaise)} during the year`);
  if (revenue === null) unknown.push("total revenue for the year");
  else if (revenue > ex.revenueMaxPaise) fails.push(`total revenue above ${crore(ex.revenueMaxPaise)}`);

  if (fails.length) return { status: small === null ? "undetermined" : "applicable", reasons: [...reasons, `Private-company exemption not available: ${fails.join("; ")}`], missing: small === null ? missing : [] };
  if (unknown.length) return { status: "undetermined", reasons: [...reasons, "Private-company exemption cannot be decided"], missing: [...missing, ...unknown] };
  return { status: "not-applicable", reasons: [...reasons, "Private-company exemption: within all para 1(2)(v) limits and not a holding/subsidiary of a public company"], missing: [] };
}

export type ClauseApplicability = "Applicable" | "Not applicable" | "To determine";
export type CaroClause = { clause: string; title: string; applicability: ClauseApplicability; basis: string; information: string; wp: string };

/** Balances (paise, |net|) of lead areas the clause logic looks at. */
export type CaroFacts = { ppePaise: number; inventoryPaise: number; investmentsPaise: number; loansAdvancesPaise: number; borrowingsPaise: number };

type ClauseDef = { clause: string; title: string; wp: string; information: string; decide: (p: EntityProfile | null, f: CaroFacts) => [ClauseApplicability, string] };

const always = (basis = "Reported by every company to which the Order applies"): ClauseDef["decide"] => () => ["Applicable", basis];
const flag = (v: boolean | undefined, yes: string, no: string, unknown: string): [ClauseApplicability, string] => (v === true ? ["Applicable", yes] : v === false ? ["Not applicable", no] : ["To determine", unknown]);
const balance = (paise: number, yes: string, no: string): [ClauseApplicability, string] => (paise !== 0 ? ["Applicable", yes] : ["To determine", no]);

function internalAudit(p: EntityProfile | null): [ClauseApplicability, string] {
  if (!p) return ["To determine", "Entity profile not provided"];
  if (p.internalAuditRequired !== undefined) return flag(p.internalAuditRequired, "Internal audit required under s.138 (per profile)", "s.138 not applicable (per profile)", "");
  if (p.listed) return ["Applicable", "Listed company: s.138 applies"];
  const isPublic = p.companyClass === "public";
  const ia = isPublic ? INTERNAL_AUDIT.unlistedPublic : INTERNAL_AUDIT.private;
  const paidMin = isPublic ? INTERNAL_AUDIT.unlistedPublic.paidUpMinPaise : null;
  const turnover = p.turnoverPaise;
  const borrow = p.maxBorrowingsPaise;
  const paid = p.paidUpCapitalPaise;
  const over = (turnover !== null && turnover >= ia.turnoverMinPaise) || (borrow !== null && borrow >= ia.borrowingsMinPaise) || (paidMin !== null && paid !== null && paid >= paidMin);
  if (over) return ["Applicable", "Meets an s.138 / rule 13 threshold"];
  if (turnover === null || borrow === null || (paidMin !== null && paid === null)) return ["To determine", "Turnover, borrowings or paid-up capital not given"];
  return ["Not applicable", "Below every s.138 / rule 13 threshold; confirm no deposits ≥ ₹25 crore"];
}

export const CARO_CLAUSES: ClauseDef[] = [
  { clause: "3(i)", title: "Property, plant and equipment and intangible assets — records, physical verification, title deeds, revaluation, benami proceedings", wp: "L-E", information: "Fixed asset register, physical verification report, title deeds", decide: (_p, f) => balance(f.ppePaise, "PPE / intangibles in the TB", "No PPE in the TB; confirm") },
  {
    clause: "3(ii)",
    title: "Inventory — physical verification and discrepancies; working capital limits above ₹5 crore and quarterly returns",
    wp: "L-G",
    information: "Stock verification records; sanction letters and quarterly stock statements to banks",
    decide: (p, f) => (f.inventoryPaise !== 0 || p?.hasInventory ? ["Applicable", "Inventory in the TB"] : p?.hasInventory === false ? ["Not applicable", "No inventory (per profile)"] : ["To determine", "No inventory ledger in the TB; confirm"]),
  },
  { clause: "3(iii)", title: "Investments, guarantees, security, loans or advances granted to companies, firms, LLPs or other parties", wp: "L-F / L-J", information: "Loan agreements, investment register, board approvals", decide: (_p, f) => balance(f.investmentsPaise + f.loansAdvancesPaise, "Investments / loans and advances in the TB", "No investments or loans given in the TB; confirm") },
  { clause: "3(iv)", title: "Compliance with sections 185 and 186 for loans, investments, guarantees and security", wp: "L-J", information: "Register under s.186; s.185 compliance", decide: always() },
  { clause: "3(v)", title: "Deposits accepted or deemed deposits — sections 73 to 76 and the rules", wp: "L-B", information: "Unsecured loan confirmations; DPT-3", decide: always() },
  { clause: "3(vi)", title: "Maintenance of cost records under section 148(1)", wp: "B2", information: "Cost records applicability (Companies (Cost Records and Audit) Rules)", decide: (p) => flag(p?.costRecordsApplicable, "Cost records prescribed (per profile)", "Cost records not prescribed (per profile)", "Applicability of s.148 not given") },
  { clause: "3(vii)", title: "Undisputed and disputed statutory dues", wp: "L-D", information: "Statutory dues payment records; disputes pending", decide: always() },
  { clause: "3(viii)", title: "Transactions not recorded in the books surrendered or disclosed in tax assessments", wp: "B2", information: "Income-tax assessment orders / search proceedings", decide: always() },
  { clause: "3(ix)", title: "Default in repayment of loans or borrowings; wilful defaulter; utilisation of term loans and short-term funds", wp: "L-B", information: "Loan statements, sanction letters, end-use certificates", decide: (_p, f) => balance(f.borrowingsPaise, "Borrowings in the TB", "No borrowings in the TB; confirm") },
  { clause: "3(x)", title: "Money raised by public offer or preferential allotment / private placement", wp: "L-A", information: "Share allotment records, PAS-3", decide: always() },
  { clause: "3(xi)", title: "Fraud noticed or reported; whistle-blower complaints", wp: "B1", information: "Management representation on fraud; ADT-4 if any", decide: always() },
  { clause: "3(xii)", title: "Nidhi company compliance", wp: "B2", information: "Nidhi Rules compliance", decide: (p) => (p?.nidhi ? ["Applicable", "Nidhi company (per profile)"] : ["Not applicable", "Not a Nidhi company"]) },
  { clause: "3(xiii)", title: "Related-party transactions — sections 177 and 188 and disclosure", wp: "E2", information: "Related-party register (MBP-1, AOC-2), board approvals", decide: always() },
  { clause: "3(xiv)", title: "Internal audit system commensurate with size; internal audit reports considered", wp: "C2", information: "Internal audit reports", decide: (p) => internalAudit(p) },
  { clause: "3(xv)", title: "Non-cash transactions with directors or connected persons — section 192", wp: "E2", information: "Board minutes; director transactions", decide: always() },
  { clause: "3(xvi)", title: "Registration under section 45-IA of the RBI Act; core investment company", wp: "B2", information: "Financial asset/income test; RBI registration", decide: (p) => (p?.nbfc ? ["Applicable", "NBFC (per profile)"] : ["Applicable", "Every company reports whether registration is required"]) },
  { clause: "3(xvii)", title: "Cash losses in the year and the preceding year", wp: "F2", information: "Profit before tax adjusted for non-cash items, both years", decide: always() },
  { clause: "3(xviii)", title: "Resignation of the statutory auditors during the year", wp: "A1", information: "ADT-3 / predecessor communication", decide: always() },
  { clause: "3(xix)", title: "Material uncertainty on meeting liabilities within one year", wp: "F2", information: "Ageing of assets and liabilities, cash-flow forecast", decide: always() },
  { clause: "3(xx)", title: "Unspent CSR amounts — transfer to Schedule VII fund or unspent CSR account (section 135)", wp: "B2", information: "CSR computation and spend", decide: (p) => flag(p?.csrApplicable, "s.135 applies (per profile)", "s.135 does not apply (per profile)", "s.135 applicability (net worth / turnover / net profit of the preceding year) not given") },
  { clause: "3(xxi)", title: "Qualifications or adverse remarks in CARO reports of companies in the consolidated financial statements", wp: "G2", information: "CARO reports of group companies", decide: (p) => (p?.consolidated ? ["Applicable", "Consolidated financial statements"] : ["Not applicable", "Standalone financial statements only"]) },
];

export function caroChecklist(det: CaroDetermination, p: EntityProfile | null, facts: CaroFacts): CaroClause[] {
  return CARO_CLAUSES.map((c) => {
    if (det.status === "not-applicable") return { clause: c.clause, title: c.title, applicability: "Not applicable", basis: `Order not applicable: ${det.reasons[det.reasons.length - 1]}`, information: "", wp: c.wp };
    const [applicability, basis] = c.decide(p, facts);
    return { clause: c.clause, title: c.title, applicability: det.status === "undetermined" && applicability === "Applicable" ? "To determine" : applicability, basis: det.status === "undetermined" ? `Order applicability undetermined; ${basis}` : basis, information: c.information, wp: c.wp };
  });
}

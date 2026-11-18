// GST Prep data model. Everything the extract step produces is plain JSON (it is cached on the
// AgentRun and replayed by approved MistakeLog examples): amounts integer paise, rates basis
// points, dates "YYYY-MM-DD", state codes "29". `loc` is a human location for evidence
// ("sales.csv row 4", "gstr2b.json b2b[0].inv[2]").
import type { BlockedCategory, RcmService } from "./config";
import type { TaxSplit } from "./money";

export type DocType = "INV" | "CRN" | "DBN";
export type RegisterStyle = "tally" | "zoho" | "generic";

export type Line = {
  rateBps: number;
  taxable: number;
  tax: TaxSplit;
  hsn: string | null;
  description: string;
  qty: number | null;
  uqc: string | null;
};

export type SalesDoc = {
  loc: string;
  docType: DocType;
  /** As written in the register (only trimmed of surrounding whitespace for display in `display`). */
  number: string;
  date: string;
  party: string;
  gstin: string | null;
  /** Place of supply state code as given (null when the register has none). */
  pos: string | null;
  reverseCharge: boolean;
  /** Invoice / note value incl. tax, positive. */
  value: number;
  lines: Line[];
  origNumber: string | null;
  origDate: string | null;
  irn: string | null;
};

export type PurchaseDoc = {
  loc: string;
  docType: DocType;
  /** Supplier's document number (Tally: Supplier Invoice No.; Zoho: Bill Number). */
  number: string;
  date: string;
  supplier: string;
  gstin: string | null;
  pos: string | null;
  reverseCharge: boolean;
  value: number;
  lines: Line[];
  /** Free-text ledger / expense account; the model maps it to s.17(5) and RCM categories. */
  ledger: string;
  paidOn: string | null;
  /**
   * Supplier's state code from an optional register column (absent when the register has none).
   * Used only for an unregistered supplier's reverse-charge tax: a registered supplier's state is
   * its GSTIN prefix; with neither, the supplier is taken to be in the client's state.
   */
  supplierState?: string | null;
};

/** Open payables as on period end (rule 37 ageing). */
export type PayableDoc = {
  loc: string;
  supplier: string;
  gstin: string | null;
  number: string;
  date: string;
  value: number;
  paid: number;
  itc: TaxSplit;
  reversedEarlier: boolean;
};

export type B2bDoc = {
  loc: string;
  ctin: string;
  tradeName: string;
  docType: DocType;
  number: string;
  date: string;
  value: number;
  pos: string | null;
  reverseCharge: boolean;
  itcAvailable: boolean;
  reason: string;
  taxable: number;
  tax: TaxSplit;
};

export type Profile = {
  gstin: string;
  legalName: string;
  /** Aggregate annual turnover of the preceding FY (drives HSN digits, e-invoice, late-fee cap). */
  aatoPaise: number;
  filingFrequency: "monthly" | "qrmp";
  /** When staff expect to file GSTR-3B; drives the s.50 interest and late-fee estimate. Null = on time. */
  expectedFilingDate: string | null;
  /** Override of the computed GSTR-3B due date (extension notified for the period). */
  dueDate: string | null;
};

/**
 * Amounts the previous return carried forward, per tax head (positive paise): `outward` = output
 * tax (credit notes above invoices, 3.1(a)), `rcm` = reverse-charge tax (3.1(d)), `rcmItc` =
 * reverse-charge credit (4(A)(3)) — the figures the previous pack showed as outward / rcm /
 * itc.a3 carry-forward (formula re-audit NEW-5).
 */
export type CarryForwardIn = { outward: TaxSplit; rcm: TaxSplit; rcmItc: TaxSplit };

export type PrevReturn = {
  loc: string;
  period: string;
  gstr1: TaxSplit;
  gstr3b: TaxSplit;
  closingCredit: TaxSplit;
  filedOn: string | null;
  dueOn: string | null;
  /**
   * Present only when the previous-return file states what it carried forward (`carriedForward`).
   * Listed for a partner by rule gst.prior-carry-forward; never consumed automatically — this
   * period's liability and ITC are not reduced by it (owner decision: conservative GST drafts).
   */
  carryForward?: CarryForwardIn;
};

export type ModelEvidence = { quote: string; location: string };
/** Model answer for one ledger (validated and grounded; ungrounded answers arrive as insufficient_evidence). */
export type LedgerClass = {
  ledger: string;
  blockedCategory: BlockedCategory | "none" | "insufficient_evidence";
  rcmService: RcmService | "none" | "insufficient_evidence";
  evidence: ModelEvidence | null;
  note: string;
  /** ADR-009: the injection screen kept this ledger away from the model (possible prompt injection); its ITC is held back like an abstention (owner-approved 2026-11-06). */
  withheld?: true;
};
export type HsnRead = { description: string; location: string; hsn: string | null; status: "read" | "insufficient_evidence"; evidence: ModelEvidence | null; note: string };

export type SourceInfo = { file: string; style?: RegisterStyle; format?: "json" | "xlsx" | "csv" };

/** Output of extract: parsed inputs + model classifications. compute() and every rule read only this. */
export type GstExtract = {
  period: string;
  fy: string;
  profile: Profile;
  sales: SalesDoc[];
  purchases: PurchaseDoc[];
  payables: PayableDoc[];
  gstr2b: B2bDoc[];
  prev: PrevReturn | null;
  ledgers: LedgerClass[];
  hsnReads: HsnRead[];
  sources: { sales: SourceInfo; purchases: SourceInfo; gstr2b: SourceInfo; prev?: SourceInfo; payables?: SourceInfo; einvoice?: SourceInfo };
  notes: string[];
};

export type FileRole = "profile" | "sales" | "purchases" | "gstr2b" | "prev" | "payables" | "einvoice" | "eway";
export type RoleFile = { role: FileRole; name: string; kind: "csv" | "xlsx" | "json"; text?: string; base64?: string };
/** Output of the input schema: files sorted into roles; parsing (incl. async XLSX) happens in extract. */
export type GstInput = { files: RoleFile[]; ignored: string[] };

// Synthetic ROC data for unit tests (no real client). The clean case matches
// fixtures/accuracy/roc/clean-small-private: small private company, FY 2025-26.
import type { CheckInput, JobContext } from "@/lib/agents/core/runner";
import type { RocExtract } from "../analyse";
import type { FinColumn, RocInput } from "../parse";

const L = 1_00_000_00; // ₹1 lakh in paise

export const CUR: FinColumn = {
  shareCapital: 10 * L,
  reservesSurplus: 35 * L,
  longTermBorrowings: 0,
  shortTermBorrowings: 5 * L,
  tradePayables: 12 * L,
  otherLiabilities: 3 * L,
  fixedAssets: 20 * L,
  investments: 0,
  inventories: 15 * L,
  tradeReceivables: 18 * L,
  cashAndBank: 7 * L,
  otherAssets: 5 * L,
  revenueFromOperations: 240 * L,
  otherIncome: 2 * L,
  totalExpenses: 230 * L,
  taxExpense: 3 * L,
};

export const PREV: FinColumn = {
  ...CUR,
  reservesSurplus: 26 * L,
  shortTermBorrowings: 4 * L,
  tradePayables: 10 * L,
  otherLiabilities: 2 * L,
  fixedAssets: 18 * L,
  inventories: 12 * L,
  tradeReceivables: 14 * L,
  cashAndBank: 5 * L,
  otherAssets: 3 * L,
  revenueFromOperations: 200 * L,
  otherIncome: 1 * L,
  totalExpenses: 192 * L,
  taxExpense: 2.5 * L,
};

type Over = {
  company?: Partial<RocExtract["company"]>;
  auditor?: Partial<RocExtract["auditor"]>;
  directors?: RocExtract["directors"];
  shareholding?: RocExtract["shareholding"];
  current?: Partial<FinColumn>;
  previous?: Partial<FinColumn>;
  msme?: RocExtract["msme"];
  unmapped?: string[];
  questions?: string[];
  notes?: string | null;
  fy?: string;
};

export function baseExtract(o: Over = {}): RocExtract {
  return {
    fy: o.fy ?? "2025-26",
    company: {
      name: "Fixture Widgets Private Limited",
      cin: "U74999KA2018PTC000001",
      companyClass: "private",
      listed: false,
      section8: false,
      holdingOrSubsidiary: false,
      specialAct: false,
      governmentCompany: false,
      firstFinancialYear: false,
      authorisedCapitalPaise: 50 * L,
      paidUpCapitalPaise: 10 * L,
      agmDate: "2026-09-25",
      previousAgmDate: "2025-09-26",
      agmExtendedTo: null,
      declaredAnnualReturnForm: "MGT-7A",
      csrNetProfitHistoryPaise: [],
      deposits: { depositsOutstandingPaise: 0, loansNotDepositsPaise: 5 * L, dpt3FiledOn: "2026-06-25" },
      estimateFilingOn: "2026-10-15",
      ...o.company,
    },
    directors: o.directors ?? [
      { din: "01000001", name: "Asha Rao", designation: "Managing Director", dinStatus: "active", kycCompletedOn: "2026-08-20", residentInIndia: true },
      { din: "01000002", name: "Vikram Shetty", designation: "Director", dinStatus: "active", kycCompletedOn: "2026-08-22", residentInIndia: true },
    ],
    shareholding: o.shareholding ?? [
      { folio: "F-001", holder: "Asha Rao", shareClass: "Equity", shares: 60000, faceValuePaise: 1000, paidUpPerSharePaise: 1000 },
      { folio: "F-002", holder: "Vikram Shetty", shareClass: "Equity", shares: 40000, faceValuePaise: 1000, paidUpPerSharePaise: 1000 },
    ],
    auditor: {
      name: "Fixture & Co LLP",
      frn: "000001S",
      type: "firm",
      termStartFy: "2022-23",
      termYears: 5,
      consecutiveYearsBeforeTerm: 0,
      reappointedAtThisAgm: false,
      newAuditorAtThisAgm: false,
      casualVacancy: false,
      ...o.auditor,
    },
    financials: { source: "summary", current: { ...CUR, ...o.current }, previous: { ...PREV, ...o.previous }, unmappedLedgers: o.unmapped ?? [], ledgerQuestions: o.questions ?? [] },
    msme: o.msme ?? [],
    notes: o.notes === undefined ? null : o.notes,
  };
}

export const JOB: JobContext = {
  jobTaskId: "job-1",
  title: "ROC annual filing",
  service: "ROC",
  fy: "2025-26",
  period: "Annual",
  clientCode: "ACME01",
  clientName: "Fixture Widgets Private Limited",
  assigneeId: null,
  reviewerId: null,
};

export const checkInput = (x: RocExtract): CheckInput<RocInput, RocExtract> => ({ input: {} as RocInput, extracted: x, figures: {}, job: JOB });

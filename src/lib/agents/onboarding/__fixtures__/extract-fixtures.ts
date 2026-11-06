// 20 plain-English onboarding prompts → the router's (unmasked) model output → the partial spec
// the pipeline must produce. The router is mocked to return `model`, so these fixtures test the
// deterministic pipeline: dictionary, schema, normalization, merge, people resolution.
import type { ExtractedSpec, PartialSpec } from "../spec";
import { PAN, gstinFor } from "./synthetic";

export interface ExtractFixture {
  name: string;
  prompt: string;
  model: ExtractedSpec;
  expected: PartialSpec;
  /** Org names the masking dictionary must contain. */
  orgs?: string[];
  ambiguous?: { assigneeId?: number; reviewerId?: number };
}

const G29C = gstinFor("29", PAN.company);
const G33C = gstinFor("33", PAN.company, "2");

export const EXTRACT_FIXTURES: ExtractFixture[] = [
  {
    name: "spec example: pvt ltd, GST monthly + ROC + books monthly",
    prompt: "Onboard Acme Pvt Ltd — private limited, GST monthly + ROC + books monthly, assign Priya Sharma, reviewer Ravi.",
    model: {
      legalName: "Acme Pvt Ltd", entityType: "PVT_LTD",
      services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC", frequency: null }, { service: "Books", frequency: "MONTHLY" }],
      assigneeName: "Priya Sharma", reviewerName: "Ravi",
    },
    expected: {
      legalName: "Acme Pvt Ltd", entityType: "PVT_LTD",
      services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC", frequency: "ANNUAL" }, { service: "Books", frequency: "MONTHLY" }],
      assigneeName: "Priya Sharma", assigneeId: "u-priya", reviewerName: "Ravi Kumar", reviewerId: "u-ravi",
    },
    orgs: ["Acme Pvt Ltd"],
  },
  {
    name: "LLP with code, FY and first month",
    prompt: "New client Lotus Ledger LLP, code LOTUS, from FY 2026-27 starting Nov 2026: GST monthly and income tax. Karthik does it, Anita reviews.",
    model: {
      legalName: "Lotus Ledger LLP", entityType: "LLP", clientCode: "lotus", fy: "FY 2026-27", firstPeriod: "Nov 2026",
      services: [{ service: "GST", frequency: "MONTHLY" }, { service: "IncomeTax" }], assigneeName: "Karthik", reviewerName: "Anita",
    },
    expected: {
      legalName: "Lotus Ledger LLP", entityType: "LLP", clientCode: "LOTUS", fy: "2026-27", firstPeriod: "2026-11",
      services: [{ service: "GST", frequency: "MONTHLY" }, { service: "IncomeTax", frequency: "ANNUAL" }],
      assigneeName: "Karthik Iyer", assigneeId: "u-karthik", reviewerName: "Anita Desai", reviewerId: "u-anita",
    },
    orgs: ["Lotus Ledger LLP"],
  },
  {
    name: "proprietorship under QRMP",
    prompt: "Onboard Sri Balaji Traders, proprietorship, GST quarterly under QRMP, assign Meena, reviewer Ravi Kumar.",
    model: {
      legalName: "Sri Balaji Traders", entityType: "PROPRIETORSHIP", services: [{ service: "GST", frequency: "QUARTERLY" }],
      assigneeName: "Meena", reviewerName: "Ravi Kumar",
    },
    expected: {
      legalName: "Sri Balaji Traders", entityType: "PROPRIETORSHIP", services: [{ service: "GST", frequency: "QUARTERLY" }],
      assigneeName: "Meena Pillai", assigneeId: "u-meena", reviewerName: "Ravi Kumar", reviewerId: "u-ravi",
    },
    orgs: ["Sri Balaji Traders"],
  },
  {
    name: "individual ITR only, PAN in lower case with spaces",
    prompt: "Add Dr Suresh Menon (individual), PAN abcpk 1234m, ITR every year. Anita prepares, Karthik reviews.",
    model: { legalName: "Dr Suresh Menon", entityType: "INDIVIDUAL", pan: "abcpk 1234m", services: [{ service: "IncomeTax", frequency: "ANNUAL" }], assigneeName: "Anita", reviewerName: "Karthik" },
    expected: {
      legalName: "Dr Suresh Menon", entityType: "INDIVIDUAL", pan: PAN.individual, services: [{ service: "IncomeTax", frequency: "ANNUAL" }],
      assigneeName: "Anita Desai", assigneeId: "u-anita", reviewerName: "Karthik Iyer", reviewerId: "u-karthik",
    },
  },
  {
    name: "HUF with turnover in lakh already converted by the model",
    prompt: "Onboard Ramesh Kumar HUF, HUF, income tax and books annual, turnover 45 lakh. Assign Priya Sharma, reviewer Anita.",
    model: {
      legalName: "Ramesh Kumar HUF", entityType: "HUF", turnoverInr: 4_500_000,
      services: [{ service: "IncomeTax" }, { service: "Books", frequency: "ANNUAL" }], assigneeName: "Priya Sharma", reviewerName: "Anita",
    },
    expected: {
      legalName: "Ramesh Kumar HUF", entityType: "HUF", turnoverInr: 4_500_000,
      services: [{ service: "IncomeTax", frequency: "ANNUAL" }, { service: "Books", frequency: "ANNUAL" }],
      assigneeName: "Priya Sharma", assigneeId: "u-priya", reviewerName: "Anita Desai", reviewerId: "u-anita",
    },
  },
  {
    name: "partnership firm with TDS (default quarterly) and audit",
    prompt: "Shah & Co, a partnership firm, needs TDS returns and tax audit. Ravi to handle, Karthik to review.",
    model: { legalName: "Shah & Co", entityType: "PARTNERSHIP", services: [{ service: "TDS" }, { service: "Audit" }], assigneeName: "Ravi", reviewerName: "Karthik" },
    expected: {
      legalName: "Shah & Co", entityType: "PARTNERSHIP", services: [{ service: "TDS", frequency: "QUARTERLY" }, { service: "Audit", frequency: "ANNUAL" }],
      assigneeName: "Ravi Kumar", assigneeId: "u-ravi", reviewerName: "Karthik Iyer", reviewerId: "u-karthik",
    },
    orgs: ["Shah & Co"],
  },
  {
    name: "trust: audit + income tax, engagement letter",
    prompt: "Onboard Seva Foundation Trust — trust, statutory audit, ITR and an engagement letter. Meena prepares, Anita Desai reviews.",
    model: {
      legalName: "Seva Foundation Trust", entityType: "TRUST_SOCIETY",
      services: [{ service: "Audit" }, { service: "IncomeTax" }, { service: "Engagement" }], assigneeName: "Meena", reviewerName: "Anita Desai",
    },
    expected: {
      legalName: "Seva Foundation Trust", entityType: "TRUST_SOCIETY",
      services: [{ service: "IncomeTax", frequency: "ANNUAL" }, { service: "Audit", frequency: "ANNUAL" }, { service: "Engagement", frequency: "ANNUAL" }],
      assigneeName: "Meena Pillai", assigneeId: "u-meena", reviewerName: "Anita Desai", reviewerId: "u-anita",
    },
    orgs: ["Seva Foundation Trust"],
  },
  {
    name: "public limited with CIN in lower case",
    prompt: "Onboard Deccan Steel Limited, public limited, CIN l27100ka1990plc012345, ROC annual filing, Karthik assignee, Ravi reviewer.",
    model: { legalName: "Deccan Steel Limited", entityType: "PUBLIC_LTD", cin: "l27100ka1990plc012345", services: [{ service: "ROC", frequency: "ANNUAL" }], assigneeName: "Karthik", reviewerName: "Ravi" },
    expected: {
      legalName: "Deccan Steel Limited", entityType: "PUBLIC_LTD", cin: "L27100KA1990PLC012345", services: [{ service: "ROC", frequency: "ANNUAL" }],
      assigneeName: "Karthik Iyer", assigneeId: "u-karthik", reviewerName: "Ravi Kumar", reviewerId: "u-ravi",
    },
    orgs: ["Deccan Steel Limited"],
  },
  {
    name: "repeated service: last mention wins",
    prompt: "Kaveri Foods Pvt Ltd: GST monthly. Actually make GST quarterly. Books monthly. Priya Sharma and Ravi.",
    model: {
      legalName: "Kaveri Foods Pvt Ltd", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "GST", frequency: "QUARTERLY" }, { service: "Books", frequency: "MONTHLY" }],
      assigneeName: "Priya Sharma", reviewerName: "Ravi",
    },
    expected: {
      legalName: "Kaveri Foods Pvt Ltd", services: [{ service: "GST", frequency: "QUARTERLY" }, { service: "Books", frequency: "MONTHLY" }],
      assigneeName: "Priya Sharma", assigneeId: "u-priya", reviewerName: "Ravi Kumar", reviewerId: "u-ravi",
    },
    orgs: ["Kaveri Foods Pvt Ltd"],
  },
  {
    name: "two GSTINs in lower case, duplicated",
    prompt: `Acme Widgets Private Limited, GSTINs ${G29C.toLowerCase()} and ${G33C}, also ${G29C}. GST monthly.`,
    model: { legalName: "Acme Widgets Private Limited", gstins: [G29C.toLowerCase(), G33C, G29C], services: [{ service: "GST", frequency: "MONTHLY" }] },
    expected: { legalName: "Acme Widgets Private Limited", gstins: [G29C, G33C], services: [{ service: "GST", frequency: "MONTHLY" }] },
    orgs: ["Acme Widgets Private Limited"],
  },
  {
    name: "contact details: +91 phone, upper-case email",
    prompt: "Onboard Nila Textiles LLP. Contact Lakshmi Rao, LAKSHMI@NILA.TEST, +91 98450-12345.",
    model: { legalName: "Nila Textiles LLP", entityType: "LLP", contactName: "Lakshmi  Rao", contactEmail: "LAKSHMI@NILA.TEST", contactPhone: "+91 98450-12345" },
    expected: { legalName: "Nila Textiles LLP", entityType: "LLP", contactName: "Lakshmi Rao", contactEmail: "lakshmi@nila.test", contactPhone: "9845012345" },
    orgs: ["Nila Textiles LLP"],
  },
  {
    name: "quarter as first period resolves inside the FY",
    prompt: "Hebbal Motors Pvt Ltd, FY 2026-2027, start from Q3, TDS and GST monthly.",
    model: { legalName: "Hebbal Motors Pvt Ltd", fy: "FY 2026-2027", firstPeriod: "Q3", services: [{ service: "TDS" }, { service: "GST", frequency: "MONTHLY" }] },
    expected: { legalName: "Hebbal Motors Pvt Ltd", fy: "2026-27", firstPeriod: "2026-10", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "TDS", frequency: "QUARTERLY" }] },
    orgs: ["Hebbal Motors Pvt Ltd"],
  },
  {
    name: "Q4 first period falls in the next calendar year",
    prompt: "Coorg Estates LLP, FY 2026-27, books quarterly from Q4.",
    model: { legalName: "Coorg Estates LLP", fy: "2026-27", firstPeriod: "Q4", services: [{ service: "Books", frequency: "QUARTERLY" }] },
    expected: { legalName: "Coorg Estates LLP", fy: "2026-27", firstPeriod: "2027-01", services: [{ service: "Books", frequency: "QUARTERLY" }] },
    orgs: ["Coorg Estates LLP"],
  },
  {
    name: "billing, DSC holder and books software",
    prompt: "Onboard Mysore Silks Pvt Ltd, retainer ₹20,000 a month, DSC with director Kiran, books in Zoho.",
    model: { legalName: "Mysore Silks Pvt Ltd", billing: "Retainer ₹20,000 per month", dscHolder: "Director Kiran", booksSoftware: "Zoho" },
    expected: { legalName: "Mysore Silks Pvt Ltd", billing: "Retainer ₹20,000 per month", dscHolder: "Director Kiran", booksSoftware: "Zoho" },
    orgs: ["Mysore Silks Pvt Ltd"],
  },
  {
    name: "ambiguous assignee first name",
    prompt: "Onboard Ganga Exports LLP, GST monthly, assign Priya, reviewer Ravi.",
    model: { legalName: "Ganga Exports LLP", services: [{ service: "GST", frequency: "MONTHLY" }], assigneeName: "Priya", reviewerName: "Ravi" },
    expected: { legalName: "Ganga Exports LLP", services: [{ service: "GST", frequency: "MONTHLY" }], assigneeName: "Priya", reviewerName: "Ravi Kumar", reviewerId: "u-ravi" },
    orgs: ["Ganga Exports LLP"],
    ambiguous: { assigneeId: 2 },
  },
  {
    name: "unknown assignee stays a name, no id",
    prompt: "Onboard Vega Labs Pvt Ltd, ROC, assign Zubin, reviewer Anita.",
    model: { legalName: "Vega Labs Pvt Ltd", services: [{ service: "ROC" }], assigneeName: "Zubin", reviewerName: "Anita" },
    expected: { legalName: "Vega Labs Pvt Ltd", services: [{ service: "ROC", frequency: "ANNUAL" }], assigneeName: "Zubin", reviewerName: "Anita Desai", reviewerId: "u-anita" },
    orgs: ["Vega Labs Pvt Ltd"],
    ambiguous: { assigneeId: 0 },
  },
  {
    name: "whitespace, nulls and empty strings are dropped",
    prompt: "Onboard   Indus   Tech  Pvt Ltd  ",
    model: { legalName: "  Indus   Tech  Pvt Ltd ", clientCode: "  ", pan: null, gstins: [], services: [], contactEmail: "", turnoverInr: null },
    expected: { legalName: "Indus Tech Pvt Ltd" },
    orgs: ["Indus Tech Pvt Ltd"],
  },
  {
    name: "client code with spaces is upper-cased and squeezed",
    prompt: "Code it as srca 26 — Srinivas & Associates, partnership, income tax.",
    model: { legalName: "Srinivas & Associates", entityType: "PARTNERSHIP", clientCode: "srca 26", services: [{ service: "IncomeTax" }] },
    expected: { legalName: "Srinivas & Associates", entityType: "PARTNERSHIP", clientCode: "SRCA26", services: [{ service: "IncomeTax", frequency: "ANNUAL" }] },
    orgs: ["Srinivas & Associates"],
  },
  {
    name: "everything in one sentence",
    prompt: `Onboard Acme Widgets Private Limited (ACME01), private limited, PAN ${PAN.company}, GSTIN ${G29C}, CIN U12345KA2020PTC123456, FY 2026-27 from 2026-11, GST monthly, ROC, books monthly in Tally, turnover 2.5 crore, retainer ₹15,000 per month, DSC with director Meera Rao, contact Meera Rao meera@acme.test 9876543210, assign Priya Sharma, reviewer Ravi Kumar.`,
    model: {
      legalName: "Acme Widgets Private Limited", clientCode: "ACME01", entityType: "PVT_LTD", pan: PAN.company, gstins: [G29C], cin: "U12345KA2020PTC123456",
      fy: "2026-27", firstPeriod: "2026-11", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC", frequency: "ANNUAL" }, { service: "Books", frequency: "MONTHLY" }],
      booksSoftware: "Tally", turnoverInr: 25_000_000, billing: "Retainer ₹15,000 per month", dscHolder: "Director (Meera Rao)",
      contactName: "Meera Rao", contactEmail: "meera@acme.test", contactPhone: "9876543210", assigneeName: "Priya Sharma", reviewerName: "Ravi Kumar",
    },
    expected: {
      legalName: "Acme Widgets Private Limited", clientCode: "ACME01", entityType: "PVT_LTD", pan: PAN.company, gstins: [G29C], cin: "U12345KA2020PTC123456",
      fy: "2026-27", firstPeriod: "2026-11", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "ROC", frequency: "ANNUAL" }, { service: "Books", frequency: "MONTHLY" }],
      booksSoftware: "Tally", turnoverInr: 25_000_000, billing: "Retainer ₹15,000 per month", dscHolder: "Director (Meera Rao)",
      contactName: "Meera Rao", contactEmail: "meera@acme.test", contactPhone: "9876543210",
      assigneeName: "Priya Sharma", assigneeId: "u-priya", reviewerName: "Ravi Kumar", reviewerId: "u-ravi",
    },
    orgs: ["Acme Widgets Private Limited"],
  },
  {
    name: "unparseable values are kept as typed for the validators to flag",
    prompt: "Onboard Blue Hills Enterprises, phone 12345, FY next year, first period sometime.",
    model: { legalName: "Blue Hills Enterprises", contactPhone: "12345", fy: "next year", firstPeriod: "sometime" },
    expected: { legalName: "Blue Hills Enterprises", contactPhone: "12345", fy: "next year", firstPeriod: "sometime" },
    orgs: ["Blue Hills Enterprises"],
  },
];

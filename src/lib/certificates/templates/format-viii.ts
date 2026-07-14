import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format viii — Independent Practitioner's Certificate on Receipt and Utilization of
// Grant and related income where audited Financial Statements are NOT available
// (Annexure III). Limited-assurance twin of Format vii: no audit-party / isCompany /
// opinion toggles. Locked wording transcribed verbatim from the source PDF (pages 81–84).
// Run `npm run verify:certs -- --only viii-receipt-b`.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const col = (key: string, label: string, numeric = true) => ({ key, label, numeric });

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "grantPurpose", label: "Purpose of the grant", type: "text", required: true, repeatKey: "PURPOSE" },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "fyEndYear", label: "Financial year-end year (fills every 'March 31, 20XX')", type: "year", required: true, repeatKey: "FYEND" },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },

  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },

  { key: "grantReceivedTable", label: "Statement A — Grant and related income received", type: "table", table: {
    rowLabels: ["Grant Received", "1.", "2.", "3.", "4.", "Other Related Income", "1.", "2.", "Total"],
    columns: [col("source", "Funding Source / Agency", false), col("date", "Date", false), col("mode", "Mode of Receipt (NEFT/Cash/Cheque/Others)", false), col("amount", "Amount (INR)")],
    computedRows: [{ rowIndex: 8, formula: "sumAbove" }],
  } },
  { key: "grantUtilizationTable", label: "Statement B — Utilization of Grant", type: "table", table: {
    rowLabels: ["Awareness Drives and Publicity Campaigns", "Printing and Distribution of IEC Materials", "Volunteer Training Programs", "Transportation and Logistics", "Administrative Expenses (within permissible limits)", "Others", "Total"],
    columns: [col("amount", "Amount Utilized (INR)")],
    computedRows: [{ rowIndex: 6, formula: "sumAbove" }],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate on Receipt and Utilization of Grant and related income for "),
  f("grantPurpose"),
  t(" for the Financial Year ended March 31, "),
  f("fyEndYear"),

  t("\n\n1. This Certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter/agreement dated "),
  f("engagementLetterDate"),
  t(".\n\n2. "),
  f("sg_iweCap"),
  t(" have been requested by "),
  f("entityName"),
  t(` (hereinafter the "entity"), and having its registered office at `),
  f("entityRegdOffice"),
  t(", to certify the Statement of Receipt and Utilization of Grant and related income for "),
  f("grantPurpose"),
  t(" for the Financial Year ended March 31, "),
  f("fyEndYear"),
  t(` ("the Statement") for submission to `),
  f("authorityName"),
  t(". The Statement has been initialed by "),
  f("sg_meus"),
  t(" for identification purpose only."),

  t("\n\nManagement's Responsibility\n\n3. The preparation of the Statement is the responsibility of the Management of the entity including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation, and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),

  t("\n\nPractitioner's Responsibility\n\n4. It is "),
  f("sg_myour"),
  t(" responsibility to provide limited assurance on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the unaudited Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t(" of the entity. The procedures performed in a limited assurance engagement vary in nature and timing from, and are less in extent than for, a reasonable assurance engagement; and consequently, the level of assurance obtained in a limited assurance engagement is substantially lower than the assurance that would have been obtained had a reasonable assurance engagement been performed. Accordingly, "),
  f("sg_iwe"),
  t(" have performed the following procedures in relation to the Statement presented to "),
  f("sg_meus"),
  t(":\n(i) Checked the Grant sanction letter to review terms, purpose and eligible expenses.\n(ii) Traced and agreed the amounts in the attached Statement, to the unaudited financial statements of the entity as at and for the year ended March 31, "),
  f("fyEndYear"),
  t(" and checked whether amount of grants received and spent have been adequately disclosed in the financial statements.\n(iii) Verified the Grant Receipt from bank statements, receipts and ledger entries.\n(iv) Verified the funds utilized from bank statements, cash book of the entity, invoices, bills, and vouchers.\n(v) Checked whether the expenses incurred are eligible, within the grant period, and duly approved.\n(vi) Checked whether a dedicated Bank Account exists for the receipt of the said grant.\n(vii) Reconciled the total grant received, spent, and closing balance.\n(viii) Checked whether proper checks and internal controls exist for fund disbursements.\n(ix) Obtained written representation from the management of the entity on the total amount unspent and their plan to disburse the unspent grant amount."),

  t("\n\n5. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(` examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the Institute of Chartered Accountants of India ("ICAI"). The Guidance Note requires that `),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n6. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements."),

  t("\n\nConclusion\n\n7. Based on "),
  f("sg_myour"),
  t(" examination as above, and the information and explanations given to "),
  f("sg_meus"),
  t(", nothing has come to "),
  f("sg_myour"),
  t(" attention that causes "),
  f("sg_meus"),
  t(" to believe that the receipt of grant and its utilization and related income is not for the "),
  f("grantPurpose"),
  t(" as detailed in the Statement"),

  t("\n\nRestriction on Use\n\n8. This Certificate has been issued at the request of the Management of the entity for submission to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block
  t("\n\nFOR "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm's Registration Number "),
  f("firmRegistrationNumber"),
  t(")\n\nSignature\n"),
  f("memberName"),
  t("\n"),
  f("designation"),
  t("\nMembership No: "),
  f("membershipNo"),
  t("\nPlace of signature: "),
  f("placeOfSignature"),
  t("\nUDIN: "),
  f("udin"),
  t("\nDate: "),
  f("certificateDate"),

  // Enclosure
  t("\n\nEnclosure: Statement of Receipt and Utilization of Grant and related income for "),
  f("grantPurpose"),
  t(" for the Financial Year ended March 31, "),
  f("fyEndYear"),

  // Statement + tables
  t("\n\nStatement of Receipt and Utilization of Grant and related income for the Financial Year ended March 31, "),
  f("fyEndYear"),
  t("\nA. Grant and related income received:"),
  f("grantReceivedTable"),
  t("B. Utilization of Grant"),
  f("grantUtilizationTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatVIII: CertificateTemplate = {
  id: "viii-receipt-b",
  romanNo: "viii",
  title: "Independent Practitioner's Certificate on Receipt and Utilization of Grant and related income (audited FS not available)",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [81, 84],
  hash: "1ab92fd8264cabf492ba0a8f951b5c8ac47b1217e3022bb6864d4828ee54fc1e", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["grantReceivedTable", "grantUtilizationTable"],
  notes: [
    "Unaudited limited-assurance twin of Format vii: no audit-party / isCompany / opinion toggles; (i)–(ix) procedures list; Conclusion (not Opinion).",
    "Conclusion sentence ends without a full stop, per source.",
    "Statement B header is 'B. Utilization of Grant' (no colon) here vs vii's colon — kept verbatim.",
    "Grant tables identical to vii (dynamic list modelled as fixed-row grid; parentheses not [brackets] in Mode column label).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format vii — Independent Practitioner's Certificate on Receipt and Utilization of Grant
// and related income, where audited Financial Statements ARE available (Annexure III).
// Locked wording transcribed verbatim from the source PDF (pages 77–80).
// Run `npm run verify:certs -- --only vii-receipt-a`.
//
// Reuses the three-way audit-party toggle + isCompany + reliance block (Formats iii/v).
// No consolidated toggle here (the wording is plain "Financial Statements").

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const triple = (selfFirm: string, selfIndividual: string, another: string) => [
  { value: "self_firm", label: selfFirm, fragment: selfFirm },
  { value: "self_individual", label: selfIndividual, fragment: selfIndividual },
  { value: "another_firm", label: another, fragment: another },
];
const col = (key: string, label: string, numeric = true) => ({ key, label, numeric });

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "grantPurpose", label: "Purpose of the grant", type: "text", required: true, repeatKey: "PURPOSE", help: "fills every [specify the purpose]" },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "auditReportDate", label: "Audit report date (para 5)", type: "date", required: true },
  { key: "fyEndYear", label: "Financial year-end year (fills every 'March 31, 20XX')", type: "year", required: true, repeatKey: "FYEND" },

  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },

  { key: "auditParty", label: "The Financial Statements were audited by", type: "enumToggle", required: true, options: [
    { value: "self_firm", label: "Us (this firm)", fragment: "" },
    { value: "self_individual", label: "Me", fragment: "" },
    { value: "another_firm", label: "Another firm of Chartered Accountants", fragment: "" },
  ] },
  { key: "ap_audited", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("us", "me", "another firm of Chartered Accountants") },
  { key: "ap_subject", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("we", "I", "they") },
  { key: "ap_possCap", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("Our", "My", "Their") },
  { key: "ap_poss", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("our", "my", "their") },

  { key: "auditOpinion", label: "Audit opinion (para 5)", type: "enumToggle", required: true, options: [
    { value: "unmodified", label: "Unmodified", fragment: "unmodified" },
    { value: "modified", label: "Modified", fragment: "modified" },
  ] },
  { key: "isCompany", label: "Entity is a Company", type: "boolToggle", required: true, onText: ", as specified under section 143(10) of the Companies Act, 2013", offText: "" },

  { key: "anotherFirmReliance", label: "Reliance on another firm (auto)", type: "optionalBlock", enabledWhen: { field: "auditParty", equals: "another_firm" },
    subSegments: [
      { kind: "text", text: " For the financial statements, which have been audited by another firm of Chartered Accountants, " },
      { kind: "field", key: "sg_iwe" },
      { kind: "text", text: " have relied on their audited financial statements and report" },
    ],
  },

  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  // Statement A — Grant and related income received. Dynamic list; fixed-row grid interim.
  // Column label uses parentheses (not the source's [square brackets], which the leak guard forbids).
  { key: "grantReceivedTable", label: "Statement A — Grant and related income received", type: "table", table: {
    rowLabels: ["Grant Received", "1.", "2.", "3.", "4.", "Other Related Income", "1.", "2.", "Total"],
    columns: [col("source", "Funding Source / Agency", false), col("date", "Date", false), col("mode", "Mode of Receipt (NEFT/Cash/Cheque/Others)", false), col("amount", "Amount (INR)")],
    computedRows: [{ rowIndex: 8, formula: "sumAbove" }],
  } },
  // Statement B — Utilization of Grant. Fixed activity rows + computed Total.
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
  t(" responsibility to report on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the Financial Statements and books of account of the entity for the Financial Year ended March 31, "),
  f("fyEndYear"),
  t("."),

  t("\n\n5. The Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t(" referred to in paragraph 4 above have been audited/by "),
  f("ap_audited"),
  t(", on which "),
  f("ap_subject"),
  t(" issued an "),
  f("auditOpinion"),
  t(" audit opinion vide "),
  f("ap_poss"),
  t(" report dated "),
  f("auditReportDate"),
  t(". "),
  f("ap_possCap"),
  t(" audit of these financial statements was conducted in accordance with the Standards on Auditing"),
  f("isCompany"),
  t(` and other applicable authoritative pronouncements issued by the Institute of Chartered Accountants of India ("ICAI"). Those standards require that `),
  f("ap_subject"),
  t(" plan and perform the audit to obtain reasonable assurance about whether the financial statements are free of material misstatement."),
  f("anotherFirmReliance"),

  t("\n\n6. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(" examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the ICAI. The Guidance Note requires that "),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements."),

  t("\n\nOpinion\n\n8. Based on "),
  f("sg_myour"),
  t(" examination, as above, and the information and explanations given to "),
  f("sg_meus"),
  t(", "),
  f("sg_iwe"),
  t(" report that the receipt of grant and its utilization and related income is for "),
  f("grantPurpose"),
  t(" as detailed in the Statement."),

  t("\n\nRestriction on Use\n\n9. This Certificate has been issued at the request of the Management of the entity for submission to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block (Format vii labels: "FOR", "Registration Number ….", "Membership No:")
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

  // Statement heading + tables
  t("\n\nStatement of Receipt and Utilization of Grant and related income for the Financial Year ended March 31, "),
  f("fyEndYear"),
  t("\nA. Grant and related income received:"),
  f("grantReceivedTable"),
  t("B. Utilization of Grant:"),
  f("grantUtilizationTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatVII: CertificateTemplate = {
  id: "vii-receipt-a",
  romanNo: "vii",
  title: "Independent Practitioner's Certificate on Receipt and Utilization of Grant and related income (audited FS available)",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [77, 80],
  hash: "80698fa57b7820e19955093d636818b51c481b6ac62b417021a679dba7fd343a", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["grantReceivedTable", "grantUtilizationTable"],
  notes: [
    "Three-way audit party + isCompany + reliance block reused (Formats iii/v). No consolidated toggle.",
    "Source's 'audited/by' (stray slash) kept verbatim.",
    "grantPurpose ([specify the purpose]) fills subject / para 2 / opinion / enclosure.",
    "Statement A (grant received) is a dynamic list — fixed-row grid interim; Mode column label uses parentheses, not the source's [square brackets] (leak-guard forbids brackets in output).",
    "Statement B (utilization) has fixed activity rows with a computed Total (sumAbove); Statement A Total also computed.",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

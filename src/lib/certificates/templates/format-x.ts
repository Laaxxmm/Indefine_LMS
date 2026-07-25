import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format x — Independent Practitioner's Certificate on the Statement of Annual Turnover
// and Computation of Net worth pursuant to a Tender requirement, where audited Financial
// Statements are NOT available (Annexure III). Unaudited limited-assurance twin of Format
// ix. Locked wording transcribed verbatim from the source PDF (pages 90–94).
// Run `npm run verify:certs -- --only x-turnover-networth-b`.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const col = (key: string, label: string, numeric = true) => ({ key, label, numeric });

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (tender)", type: "text", required: true },
  { key: "tenderClause", label: "Tender clause reference (net-worth method)", type: "text", required: true },
  { key: "tenderDocDate", label: "Tender document date", type: "date", required: true },
  { key: "contractReference", label: "Contract reference (enter N/A if none)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },
  { key: "year1", label: "FY-end year 1 (earliest)", type: "year", required: true },
  { key: "year2", label: "FY-end year 2 (optional)", type: "year" },
  { key: "year3", label: "FY-end year 3 (optional)", type: "year" },
  { key: "year4", label: "FY-end year 4 (optional)", type: "year" },
  { key: "year5", label: "FY-end year 5 (optional)", type: "year" },
  { key: "yearsPhrase", label: "", type: "computed" },
  { key: "yearsPhraseTight", label: "", type: "computed" },
  { key: "examYear", label: "Examination reference year (para 5, fills 'March 31, 20XI')", type: "year", required: true, help: "source shows a typo '20XI' — enter the FY-end year of the examination" },

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

  { key: "turnoverTable", label: "Statement — Annual Turnover & Net worth", type: "table", table: {
    rowLabels: [], dynamicRows: true, // one row per financial year (typically 3)
    columns: [col("fy", "Financial Years", false), col("turnover", "Annual Turnover (in INR)"), col("networth", "Net worth (in INR)")],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });
// FY-list phrase is a computed value (year1 required, year2–5 optional) — see resolveValues.

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate on the Statement of Annual Turnover and computation of Net worth for the Financial Years ended "),
  f("yearsPhrase"),
  t(" pursuant to a Tender requirement"),

  t("\n\n1. This Certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter/agreement dated "),
  f("engagementLetterDate"),
  t(".\n\n2. "),
  f("sg_iweCap"),
  t(" have been requested by "),
  f("entityName"),
  t(` (hereinafter the "entity"), having its registered office at `),
  f("entityRegdOffice"),
  t(" to certify the Statement of Annual Turnover and computation of Net worth for the Financial Years ended "),
  f("yearsPhrase"),
  t(` (hereinafter referred to as the "Statement") , containing the details as required pursuant to compliance with the terms and conditions contained in `),
  f("tenderClause"),
  t(" of the tender document issued by "),
  f("authorityName"),
  t(" dated "),
  f("tenderDocDate"),
  t(" with reference to "),
  f("contractReference"),
  t(` (hereinafter referred to as the "Tender Document"), The Statement has been initialled by `),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nManagement's Responsibility\n\n3. The preparation of the Statement is the responsibility of the Management of the entity, including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),

  t("\n\n4. The management is also responsible for ensuring that the entity complies with the requirements of the Tender Document and provides all relevant information to "),
  f("authorityName"),
  t("."),

  t("\n\nPractitioner's Responsibility\n\n5. Pursuant to requirement of the Tender document, it is "),
  f("sg_myour"),
  t(" responsibility to provide a limited assurance on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the unaudited Financial Statements for the year ended March 31, "),
  f("examYear"),
  t(" of the entity whether:\ni. the amount in the Statement of Annual Turnover have been accurately extracted from the Unaudited Financial Statements of Financial Years ended "),
  f("yearsPhrase"),
  t("\nii. The amounts in the statement that form part of the Net worth computation have been accurately extracted from the Unaudited Financial Statements for the Financial Years ended "),
  f("yearsPhrase"),
  t(" and computation of Net worth is arithmetically correct and\niii. The computation of Net worth is in accordance with the method of computation set out in the "),
  f("tenderClause"),
  t(" of the Tender Document."),

  t("\n\n6. The procedures performed in a limited assurance engagement vary in nature and timing from, and are less in extent than for, a reasonable assurance engagement; and consequently, the level of assurance obtained in a limited assurance engagement is substantially lower than the assurance that would have been obtained had a reasonable assurance engagement been performed. Accordingly, "),
  f("sg_iwe"),
  t(" have performed the following procedures in relation to the Statement presented to "),
  f("sg_meus"),
  t(":\ni. Checked the general ledger and trial balance for turnover and net worth components.\nii. Cross-checked the turnover with GST returns, income tax returns, etc.\niii. Checked the sales invoice and debtor's ledger to verify the turnover.\niv. Verified that the non-operating income or revaluation reserves are not forming part of the turnover.\nv. Tested the arithmetical and clerical accuracy of the Statement.\nvi. Written confirmation from management on accuracy of turnover and net worth figures."),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(` examination of the Statements in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the Institute of Chartered Accountants of India ("ICAI"). The Guidance Note requires that `),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n8. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Service Engagements."),

  t("\n\nConclusion\n\n9. Based on the procedures carried out as mentioned above, and according to the information and explanations given to "),
  f("sg_meus"),
  t(", nothing has come to "),
  f("sg_myour"),
  t(" attention that causes "),
  f("sg_meus"),
  t(" to believe that:\ni. The amount in the Statement in respect of Annual Turnover have not been accurately extracted from the Unaudited Financial Statements for the Financial Years ended "),
  f("yearsPhraseTight"),
  t(".\nii. The amounts that form part of the Net Worth computation have not been accurately extracted from the Unaudited Financial Statements as at "),
  f("yearsPhraseTight"),
  t(", is mathematically not accurate and not in accordance with the method of computation set out in the "),
  f("tenderClause"),
  t(" of the Tender Document."),

  t("\n\nRestrictions on Use\n\n10. The certificate is addressed to and provided to the Board of Directors of the entity solely for the purpose to enable entity with requirement of Tender Document and to submit the accompanying Statement to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block (same labels as Format ix)
  t("\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm's Registration Number"),
  t(": "),
  f("firmRegistrationNumber"),
  t(")\n\nSignature\n"),
  f("memberName"),
  t("\n"),
  f("designation"),
  t("\nMembership No: "),
  f("membershipNo"),
  t("\nPlace of Signature: "),
  f("placeOfSignature"),
  t("\nUDIN: "),
  f("udin"),
  t("\nDate: "),
  f("certificateDate"),

  // Enclosure
  t("\n\nEnclosure: Statement of Annual Turnover and Computation of Net worth for the Financial Years ended "),
  f("yearsPhrase"),

  // Statement + table
  t("\n\nStatement of Annual Turnover and Computation of Net worth for the Financial Years ended "),
  f("yearsPhrase"),
  t("."),
  f("turnoverTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatX: CertificateTemplate = {
  id: "x-turnover-networth-b",
  romanNo: "x",
  title: "Independent Practitioner's Certificate on the Statement of Annual Turnover and Computation of Net worth pursuant to a Tender (audited FS not available)",
  version: "2025.11.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [90, 94],
  hash: "4ddaeed0c0e9da7059a4e05ef2ed16232e4659ab3179a0b916a666902796f56d", // §6.5 — re-pinned: years now computed (1–5)
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["turnoverTable"],
  boldFields: ["entityName", "authorityName"],
  notes: [
    "Unaudited limited-assurance twin of Format ix: no audit-party / isCompany / opinion; (i)–(vi) procedures list; negatively-phrased Conclusion ('have not been extracted... nothing has come to attention').",
    "Para 5 single-year reference 'March 31, 20XI' (source typo) → examYear field so the CA sets the examination FY-end explicitly.",
    "Three distinct years (year1/year2/year3); para 9 drops space after first comma ('March 31,20X1') — verbatim.",
    "Source typos kept verbatim: 'Related Service Engagements', 'that perform Audits', 'Restrictions on Use'.",
    "Turnover table uses the dynamic-row table type (one row per FY); Financial-Years is a user-entered text column. firmName/FRN always-required.",
  ],
};

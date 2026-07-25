import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format ix — Independent Practitioner's Certificate on the Statement of Annual Turnover
// and Computation of Net worth pursuant to a Tender requirement, where audited Financial
// Statements ARE available (Annexure III). Locked wording transcribed verbatim from the
// source PDF (pages 85–89). Run `npm run verify:certs -- --only ix-turnover-networth-a`.
//
// New shape: THREE distinct financial years (March 31, 20X1 / 20X2 / 20X3) → three year
// fields, spliced by the threeYears() helper. Reuses the three-way audit-party toggle +
// isCompany + reliance block.

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
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (tender)", type: "text", required: true },
  { key: "tenderClause", label: "Tender clause reference (net-worth method)", type: "text", required: true },
  { key: "tenderDocDate", label: "Tender document date", type: "date", required: true },
  { key: "contractReference", label: "Contract reference (enter N/A if none)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "auditReportDates", label: "Audit report dates (all 3 years, 'respectively')", type: "text", required: true, help: "e.g. 10 May 2021, 12 May 2022 and 9 May 2023" },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },
  { key: "year1", label: "FY-end year 1 (earliest)", type: "year", required: true },
  { key: "year2", label: "FY-end year 2 (optional)", type: "year" },
  { key: "year3", label: "FY-end year 3 (optional)", type: "year" },
  { key: "year4", label: "FY-end year 4 (optional)", type: "year" },
  { key: "year5", label: "FY-end year 5 (optional)", type: "year" },
  { key: "yearsPhrase", label: "", type: "computed" },
  { key: "yearsPhraseTight", label: "", type: "computed" },

  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },
  { key: "sg_amare", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("are", "am") },

  { key: "auditParty", label: "The Financial Statements were audited by", type: "enumToggle", required: true, options: [
    { value: "self_firm", label: "Us (this firm)", fragment: "" },
    { value: "self_individual", label: "Me", fragment: "" },
    { value: "another_firm", label: "Another firm of Chartered Accountants", fragment: "" },
  ] },
  { key: "ap_audited", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("us", "me", "another firm of Chartered Accountants") },
  { key: "ap_subject", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("we", "I", "they") },
  { key: "ap_possCap", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("Our", "My", "Their") },
  { key: "ap_poss", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("our", "my", "their") },

  { key: "auditOpinion", label: "Audit opinion (para 6)", type: "enumToggle", required: true, options: [
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

  // Statement of Annual Turnover & Net worth. Financial-year column is user-entered text
  // (source shows 20X0-20X1 style); leading row-label column left blank.
  { key: "turnoverTable", label: "Statement — Annual Turnover & Net worth", type: "table", table: {
    rowLabels: [], dynamicRows: true, // one row per financial year (typically 3)
    columns: [col("fy", "Financial Years", false), col("turnover", "Annual Turnover (in INR)"), col("networth", "Net worth (in INR)")],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });
// FY-list phrase is a computed value (year1 required, year2–5 optional) — see resolveValues.
// yearsPhrase = "March 31, Y1, … and March 31, YN"; yearsPhraseTight drops the first space.

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
  t(" responsibility to provide a reasonable assurance whether:\ni. the amount in the Statement of Annual Turnover have been accurately extracted from the Audited Financial Statements of Financial Years ended "),
  f("yearsPhrase"),
  t("\nii. The amounts in the statement that form part of the Net worth computation have been accurately extracted from the Audited Financial Statements for the Financial Years ended "),
  f("yearsPhrase"),
  t(" and computation of Net worth is arithmetically correct and\niii. The computation of Net worth is in accordance with the method of computation set out in the "),
  f("tenderClause"),
  t(" of the Tender Document."),

  t("\n\n6. The Audited Financial Statements referred to in paragraph 5 above, have been audited by "),
  f("ap_audited"),
  t(", on which "),
  f("ap_subject"),
  t(" issued an "),
  f("auditOpinion"),
  t(" audit opinion vide "),
  f("ap_poss"),
  t(" reports dated "),
  f("auditReportDates"),
  t(" respectively. "),
  f("ap_possCap"),
  t(" audits of these Financial Statements was conducted in accordance with the Standards on Auditing"),
  f("isCompany"),
  t(` and other applicable authoritative pronouncements issued by the Institute of Chartered Accountants of India ("ICAI"). Those Standards require that `),
  f("ap_subject"),
  t(" plan and perform the audit to obtain reasonable assurance about whether the Financial Statements are free of material misstatement."),
  f("anotherFirmReliance"),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(" examination of the Statements in accordance with the Guidance Note on Reports or Certificates for Special Purposed (Revised 2016) issued by the ICAI. The Guidance Note requires that "),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n8. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Service Engagements."),

  t("\n\nOpinion\n\n9. Based on "),
  f("sg_myour"),
  t(" examination and according to the information and explanations given to "),
  f("sg_meus"),
  t(", "),
  f("sg_iwe"),
  t(" "),
  f("sg_amare"),
  t(" of the opinion that:\ni. The amount in the Statement in respect of Annual Turnover have been accurately extracted from the Audited Financial Statements for the Financial Years ended "),
  f("yearsPhraseTight"),
  t(".\nii. The amounts that form part of the Net Worth computation have been accurately extracted from the Audited Financial Statements as at "),
  f("yearsPhraseTight"),
  t(", is mathematically accurate and in accordance with the method of computation set out in the "),
  f("tenderClause"),
  t(" of the Tender Document."),

  t("\n\nRestrictions on Use\n\n10. The certificate is addressed to and provided to the Board of Directors of the entity solely for the purpose to enable entity with requirement of Tender Document and to submit the accompanying Statement to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block (Format ix labels: "Registration Number…", "Membership No:", "Place of Signature:")
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

export const formatIX: CertificateTemplate = {
  id: "ix-turnover-networth-a",
  romanNo: "ix",
  title: "Independent Practitioner's Certificate on the Statement of Annual Turnover and Computation of Net worth pursuant to a Tender (audited FS available)",
  version: "2025.11.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [85, 89],
  hash: "cec1501a9594aef482c932b5700831314aa30c7a05446c1cf867377ac2f495f9", // §6.5 — re-pinned: years now computed (1–5)
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["turnoverTable"],
  boldFields: ["entityName", "authorityName"],
  notes: [
    "Three distinct FY-end years (year1/year2/year3) fill March 31, 20X1/20X2/20X3; para 9 drops the space after the first comma ('March 31,20X1') — kept verbatim.",
    "Audit report dates is a free-text field (source: 'reports dated … [specify the dates] respectively' — plural).",
    "contractReference is required text ('[specify the contract reference if available]' — enter N/A if none).",
    "Source typos kept verbatim: 'Special Purposed', 'Those Standards', 'audits ... was conducted', 'Related Service Engagements', 'Restrictions on Use'.",
    "Statement table uses the dynamic-row table type (one row per FY); Financial-Years is a user-entered text column; totals none.",
    "Three-way audit party + isCompany + reliance reused. firmName/FRN always-required.",
  ],
};

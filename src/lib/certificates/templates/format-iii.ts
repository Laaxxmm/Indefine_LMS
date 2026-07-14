import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format iii — Independent Practitioner's Certificate on the Statement of Property, Plant
// and Equipment and Intangible Assets, where audited Financial Statements are available
// (Annexure III). Locked wording transcribed verbatim from the source PDF (pages 59–62).
// Run `npm run verify:certs -- --only iii-ppe-statement`.
//
// New vs Formats i/ii: a THREE-way audit-party toggle in para 5 (the FS may have been
// audited by us / me / another firm), plus a conditional "relied on another firm"
// sentence that auto-appears (enabledWhen) only when another firm audited.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const triple = (selfFirm: string, selfIndividual: string, another: string) => [
  { value: "self_firm", label: selfFirm, fragment: selfFirm },
  { value: "self_individual", label: selfIndividual, fragment: selfIndividual },
  { value: "another_firm", label: another, fragment: another },
];

// PP&E / Intangible movement schedules share the same row skeleton (year dropped from
// the opening/closing labels — the year is stated in the statement title, and it keeps
// "20XX" out of output).
const movementRows = (amortLabel: string) => [
  "Gross Block:", "As on 01.04 (Opening Balance)", "Additions", "Deductions/ Reclassifications", "As on 31.03 (Closing Balance)",
  amortLabel, "As on 01.04 (Opening Balance)", "For the Year", "Deductions/Reclassifications", "As on 31.03 (Closing Balance)",
  "Impairment:", "As on 01.04 (Opening Balance)", "For the Year", "Deductions/ Reclassifications", "As on 31.03 (Closing Balance)",
  "Net Block as on 01.04", "Net Block as on 31.03",
];
const col = (key: string, label: string) => ({ key, label });

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "auditReportDate", label: "Audit report date (para 5)", type: "date", required: true },
  { key: "fyEndYear", label: "Financial year-end year (fills every 'March 31, 20XX')", type: "year", required: true, repeatKey: "FYEND" },

  // Signer (CA) conjugation
  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },

  // Who audited the Financial Statements (para 5) — us / me / another firm
  { key: "auditParty", label: "The Financial Statements were audited by", type: "enumToggle", required: true, options: [
    { value: "self_firm", label: "Us (this firm)", fragment: "" },
    { value: "self_individual", label: "Me", fragment: "" },
    { value: "another_firm", label: "Another firm of Chartered Accountants", fragment: "" },
  ] },
  { key: "ap_audited", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("us", "me", "another firm of Chartered Accountants") },
  { key: "ap_subject", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("we", "I", "they") },
  // NOTE (reviewer): source prints "vide My/our/their report" — capital retained verbatim.
  { key: "ap_possCap", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("Our", "My", "Their") },
  { key: "ap_poss", label: "", type: "enumToggle", deriveFrom: "auditParty", options: triple("our", "my", "their") },

  // Legal choices
  { key: "auditOpinion", label: "Audit opinion (para 5)", type: "enumToggle", required: true, options: [
    { value: "unmodified", label: "Unmodified", fragment: "unmodified" },
    { value: "modified", label: "Modified", fragment: "modified" },
  ] },
  { key: "isCompany", label: "Entity is a Company", type: "boolToggle", required: true, onText: ", as specified under section 143(10) of the Companies Act, 2013", offText: "" },
  { key: "preparesConsolidatedFS", label: "Entity prepares consolidated financial statements", type: "boolToggle", required: true, onText: "Standalone ", offText: "" },

  // Conditional reliance sentence — auto-on when another firm audited the FS
  { key: "anotherFirmReliance", label: "Reliance on another firm (auto)", type: "optionalBlock", enabledWhen: { field: "auditParty", equals: "another_firm" },
    subSegments: [
      { kind: "text", text: " For the financial statements, which have been audited by another firm of Chartered Accountants, " },
      { kind: "field", key: "sg_iwe" },
      { kind: "text", text: " have relied on their audited financial statements and report" },
    ],
  },

  // Signature block
  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  // Statement A — PP&E
  { key: "ppeTable", label: "Statement A — Property, Plant and Equipment (Amount in Rs.)", type: "table", table: {
    rowLabels: movementRows("Depreciation/ Amortization:"),
    columns: [col("landFreehold", "Land-Freehold"), col("buildings", "Buildings"), col("furniture", "Furniture & Fixtures"), col("officeEquip", "Office Equipment")],
  } },
  // Statement B — Intangible Assets
  { key: "intangibleTable", label: "Statement B — Intangible Assets (Amount in Rs.)", type: "table", table: {
    rowLabels: movementRows("Amortization:"),
    columns: [col("rightOfWay", "Right of Way"), col("techLicences", "Technical/Process Licences"), col("software", "Software")],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate on the Statement of Property, Plant and Equipment and Intangible Assets as at March 31, "),
  f("fyEndYear"),

  t("\n\n1. This Certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter/agreement dated "),
  f("engagementLetterDate"),
  t(".\n\n2. "),
  f("sg_iweCap"),
  t(" have been requested by "),
  f("entityName"),
  t(` (hereinafter the "entity") having its registered office at `),
  f("entityRegdOffice"),
  t(" to certify the Statement of Property, Plant and Equipment and Intangible Assets as at March 31, "),
  f("fyEndYear"),
  t(`. ("the Statement") for submission to `),
  f("authorityName"),
  t(". The Statement has been initialled by "),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nManagement's Responsibility\n\n3. The preparation of the Statement is the responsibility of the Management of the entity including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),

  t("\n\nPractitioner's Responsibility\n\n4. It is "),
  f("sg_myour"),
  t(" responsibility to report on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t("."),

  t("\n\n5. The "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the financial year ended March 31, "),
  f("fyEndYear"),
  t(" referred to in paragraph 4 above, have been audited by "),
  f("ap_audited"),
  t(", on which "),
  f("ap_subject"),
  t(" issued an "),
  f("auditOpinion"),
  t(" audit opinion vide "),
  f("ap_possCap"),
  t(" report dated "),
  f("auditReportDate"),
  t(". "),
  f("ap_poss"),
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
  t(" examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the ICAI .The Guidance Note requires that "),
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
  t(" report that the Gross Block and Net Block of the Property, Plant and Equipment and Intangible Assets as detailed in the Statement is in agreement with the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t("."),

  t("\n\nRestriction on Use\n\n9. This Certificate has been issued at the request of the Management of the entity for submission by the entity to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block
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
  t("\nPlace of signature: "),
  f("placeOfSignature"),
  t("\nUDIN: "),
  f("udin"),
  t("\nDate: "),
  f("certificateDate"),

  // Enclosure
  t("\n\nEnclosure: Statement of\nA. Property, Plant and Equipment\nB. Intangible Assets"),

  // Statement A
  t("\n\nSTATEMENT OF\nA. PROPERTY, PLANT AND EQUIPMENTS\n(As at March 31, "),
  f("fyEndYear"),
  t(")\n(Amount in Rs.)"),
  f("ppeTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),

  // Statement B
  t("\n\nB. INTANGIBLE ASSETS\n(As at March 31, "),
  f("fyEndYear"),
  t(")\n(Amount in Rs.)"),
  f("intangibleTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatIII: CertificateTemplate = {
  id: "iii-ppe-statement",
  romanNo: "iii",
  title: "Independent Practitioner's Certificate on the Statement of Property, Plant and Equipment and Intangible Assets",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [59, 63],
  hash: "c1d922a40f31ade0c04fe542fb6ee7527c7aa43cd5eb7739a7af174dd9d4260a", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["ppeTable", "intangibleTable"],
  notes: [
    "Three-way audit party (us / me / another firm) drives me·us / I·we·they / My·Our·Their; 'vide My/our/their report' capital kept verbatim.",
    "Reliance-on-another-firm sentence auto-appears only when audited by another firm (enabledWhen).",
    "PP&E / Intangible movement tables: opening/closing row labels drop the year (year is in the statement title); Net Block rows and section totals are manual (not sumAbove).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

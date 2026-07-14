import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format iv — Independent Practitioner's Certificate on the Statement of PP&E and
// Intangible Assets where audited Financial Statements are NOT available (Annexure III).
// Limited-assurance variant of Format iii: no audit was performed, so there is no
// consolidated / company / audit-opinion / audit-party toggle — only signer conjugation.
// Locked wording transcribed verbatim from the source PDF (pages 64–68).
// Run `npm run verify:certs -- --only iv-ppe-variant`.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const col = (key: string, label: string) => ({ key, label });
// year dropped from opening/closing labels (year is in the statement title → keeps 20XX out)
const movementRows = (amort: string, net: string) => [
  "Gross Block:", "As on 01.04 (Opening Balance)", "Additions", "Deductions/Reclassifications", "As on 31.03 (Closing Balance)",
  amort, "As on 01.04 (Opening Balance)", "For the Year", "Deductions/Reclassifications", "As on 31.03 (Closing Balance)",
  "Impairment:", "As on 01.04 (Opening Balance)", "For the Year", "Deductions/Reclassifications", "As on 31.03 (Closing Balance)",
  `${net} as on 01.04`, `${net} as on 31.03`,
];

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "fyEndYear", label: "Financial year-end year (fills every 'March 31, 20XX')", type: "year", required: true, repeatKey: "FYEND" },

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
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  { key: "ppeTable", label: "Statement A — Property, Plant and Equipment (Amount in Rs.)", type: "table", table: {
    rowLabels: movementRows("Depreciation/Amortization:", "Net Block"),
    columns: [col("landFreehold", "Land-Freehold"), col("buildings", "Buildings"), col("furniture", "Furniture & Fixtures"), col("officeEquip", "Office Equipment")],
  } },
  { key: "intangibleTable", label: "Statement B — Intangible Assets (Amount in Rs.)", type: "table", table: {
    rowLabels: movementRows("Amortization:", "Net-Block"),
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
  t(" responsibility to provide limited assurance on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the unaudited Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t(" of the entity. The procedures performed in a limited assurance engagement vary in nature and timing from, and are less in extent than for, a reasonable assurance engagement; and consequently, the level of assurance obtained in a limited assurance engagement is substantially lower than the assurance that would have been obtained had a reasonable assurance engagement been performed. Accordingly, "),
  f("sg_iwe"),
  t(" have performed the following procedures in relation to the Statement presented to "),
  f("sg_meus"),
  t(":\n(i) Traced and agreed the amounts in the attached Statement, to the unaudited financial statements of the entity as at and for the year ended March 31, "),
  f("fyEndYear"),
  t(".\n(ii) Checked the records of the entity showing full particulars, including quantitative details and situation of PPE.\n(iii) Checked that the additions during the year have been capitalized in accordance with the applicable accounting standards and supported by relevant invoices and documents.\n(iv) Verified whether the entity has a system of physical verification of PPE, and no material discrepancies were noticed during such verification.\n(v) Verified on a test check basis the necessary title deeds/lease agreements/ownership documents to check whether the assets owned by the entity are freehold/leasehold.\n(vi) Checked the legal ownership documents/agreements/licenses/contracts to verify the intangible assets which have been recognized in the books of account.\n(vii) Checked whether the Intangible assets with indefinite useful life (including goodwill, if any) have been tested for impairment and no material impairment has been noticed."),

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

  t("\n\nConclusion\n\n10. Based on the procedures carried out as mentioned above, and according to the information and explanations given to "),
  f("sg_meus"),
  t(", nothing has come to "),
  f("sg_myour"),
  t(" attention that causes "),
  f("sg_meus"),
  t(" to believe that the particulars mentioned in the Statement, which is prepared by the entity and initialled by "),
  f("sg_meus"),
  t(" for identification purpose, is not as detailed in the Statement."),

  t("\n\nRestriction on Use\n\n11. This Certificate has been issued at the request of the Management of the entity for submission by the entity to "),
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

export const formatIV: CertificateTemplate = {
  id: "iv-ppe-variant",
  romanNo: "iv",
  title: "Independent Practitioner's Certificate on the Statement of Property, Plant and Equipment and Intangible Assets (unaudited)",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [64, 68],
  hash: "e153a6a4457fbdbd5dd779c5600ec36784d2aaa73b8587315ef74dfcc017c40e", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["ppeTable", "intangibleTable"],
  notes: [
    "Source paragraph numbering jumps from 6 to 10/11 (Conclusion, Restriction) — kept verbatim.",
    "Movement tables: opening/closing labels drop the year; Intangible uses 'Net-Block' (hyphen) per source; totals/Net Block are manual.",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format v — Independent Practitioner's Certificate relating to the Share Capital and
// Shareholding Pattern (Annexure III). Locked wording transcribed verbatim from the
// source PDF (pages 69–72). Run `npm run verify:certs -- --only v-share-capital`.
//
// Reuses Format iii's three-way audit-party toggle + reliance block. The s.143(10)
// Companies Act clause is ALWAYS present here (the subject is a Company — no isCompany
// toggle). Submission authority (SEBI/MCA/Bank/FI/Others) is a single text field: the CA
// enters the one that applies (the source's "strike off whichever is not applicable").

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
  { key: "entityName", label: "Company name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Company — registered office address", type: "textarea", required: true },
  { key: "submissionAuthority", label: "Submission authority (SEBI / MCA / bank / FI / other)", type: "text", required: true, help: "Enter the one that applies — the source lists options to 'strike off whichever is not applicable'." },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "auditReportDate", label: "Audit report date (para 6)", type: "date", required: true },
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

  { key: "auditOpinion", label: "Audit opinion (para 6)", type: "enumToggle", required: true, options: [
    { value: "unmodified", label: "Unmodified", fragment: "unmodified" },
    { value: "modified", label: "Modified", fragment: "modified" },
  ] },
  { key: "preparesConsolidatedFS", label: "Company prepares consolidated financial statements", type: "boolToggle", required: true, onText: "Standalone ", offText: "" },

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

  // Statement A — Share Capital. Restructured from the source (which embeds [no.] and
  // [face value] inside the particulars text) into clean No./Face-value/Amount columns.
  { key: "shareCapitalTable", label: "Statement A — Share Capital", type: "table", table: {
    rowLabels: ["A. Authorised:", "Equity shares", "Preference shares", "B. Issued & Subscribed:", "Equity shares", "C. Fully Paid up:", "Equity shares"],
    columns: [col("noShares", "No. of shares"), col("faceValue", "Face value per share (Rs.)"), col("amount", "Amount in Rs.")],
  } },
  // Statement B — Shareholders. NOTE (reviewer): source is a dynamic list; the table model
  // is fixed-row, so a 10-row grid is provided as an interim — a dynamic-row table type is
  // the proper fix for production.
  { key: "shareholdersTable", label: "Statement B — Shareholders", type: "table", table: {
    rowLabels: [], dynamicRows: true, // dynamic list — CA adds one row per shareholder
    columns: [col("name", "Name of Shareholders", false), col("shares", "No. of Shares"), col("pct", "% holding")],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate relating to the Share Capital and Shareholding Pattern as at March 31 "),
  f("fyEndYear"),

  t("\n\n1. This Certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter/agreement dated "),
  f("engagementLetterDate"),
  t(".\n\n2. "),
  f("sg_iweCap"),
  t(" have been requested by "),
  f("entityName"),
  t(` (hereinafter the "Company") having its registered office at `),
  f("entityRegdOffice"),
  t(" to certify the statement containing particulars of the Authorised, Issued, Subscribed and Paid-up capital of the Company as at March 31, "),
  f("fyEndYear"),
  t(` along with details of shareholders as on that date ("the Statement") for submission to `),
  f("submissionAuthority"),
  t(". The Statement has been initialled by "),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nManagement Responsibility\n\n3. The preparation of the Statement is the responsibility of the Management of the Company including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),

  t("\n\n4. The Management is also responsible for ensuring that the Company complies with the requirements of the Companies Act 2013 including Forms and Registers relating to Share Capital and Shareholding."),

  t("\n\nPractitioner's Responsibility\n\n5. It is "),
  f("sg_myour"),
  t(" responsibility to report on the Statement based on "),
  f("sg_myour"),
  t(" examination of the particulars furnished with reference to the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t(` and Forms MGT-7 and SH-4, Minutes of Board Meetings, Register of shareholders (maintained by the Company or depository) and other records of the Company maintained pursuant to the requirements of the Companies Act, 2013 (" records of the company").`),

  t("\n\n6. The "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the financial year ended March 31, "),
  f("fyEndYear"),
  t(" referred to in paragraph 5 above, have been audited by "),
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
  t(` audit of these financial statements was conducted in accordance with the Standards on Auditing, as specified under section 143(10) of the Companies Act, 2013 and other applicable authoritative pronouncements issued by the Institute of Chartered Accountants of India ("ICAI"). Those standards require that `),
  f("ap_subject"),
  t(" plan and perform the audit to obtain reasonable assurance about whether the financial statements are free of material misstatement."),
  f("anotherFirmReliance"),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(" examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the ICAI. The Guidance Note requires that "),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n8. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements."),

  t("\n\nOpinion\n\n9. Based on "),
  f("sg_myour"),
  t(" examination, as above, and the information and explanations given to "),
  f("sg_meus"),
  t(", "),
  f("sg_iwe"),
  t(" report that the particulars of Share Capital and shareholding pattern as at March 31, "),
  f("fyEndYear"),
  t(" of the Company as provided in the enclosed Statement are in agreement with the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the year ended March 31, "),
  f("fyEndYear"),
  t(" and other records of the Company maintained pursuant to the requirements of the Companies Act, 2013 as produced to "),
  f("sg_meus"),
  t(" for "),
  f("sg_myour"),
  t(" examination."),

  t("\n\nRestriction on Use\n\n10. This Certificate has been issued at the request of the Management of the Company for submission by the Company to "),
  f("submissionAuthority"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block (Format v labels: "Registration No…", "Membership No" without colon)
  t("\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm's Registration No"),
  t(": "),
  f("firmRegistrationNumber"),
  t(")\n\nSignature\n"),
  f("memberName"),
  t("\n"),
  f("designation"),
  t("\nMembership No"),
  t(": "),
  f("membershipNo"),
  t("\nPlace of signature: "),
  f("placeOfSignature"),
  t("\nUDIN: "),
  f("udin"),
  t("\nDate: "),
  f("certificateDate"),

  // Enclosure
  t("\n\nEnclosure: Statement of:\nA. Authorised, Issued, Subscribed and Paid-up capital of the Company as at March 31, "),
  f("fyEndYear"),
  t("\nB. Shareholders as at March 31, "),
  f("fyEndYear"),
  t(" (Details of shares held by each shareholder)"),

  // Statement A — Share Capital
  t("\n\nStatement of\nA. Authorised, Issued, Subscribed and Paid-up capital of the Company as at March 31, "),
  f("fyEndYear"),
  f("shareCapitalTable"),

  // Statement B — Shareholders
  t("\n\nB. Shareholders as at March 31, "),
  f("fyEndYear"),
  t(" (Details of shares held by each shareholder)"),
  f("shareholdersTable"),

  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatV: CertificateTemplate = {
  id: "v-share-capital",
  romanNo: "v",
  title: "Independent Practitioner's Certificate relating to the Share Capital and Shareholding Pattern",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [69, 72],
  hash: "cac349c01b3f663dc479bc94ae3a8228a05a16fe26e73cb46a6e21b6a4557d94", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["shareCapitalTable", "shareholdersTable"],
  notes: [
    "Submission authority modelled as one text field (source lists SEBI/MCA/Bank/FI/Others with 'strike off whichever is not applicable').",
    "s.143(10) Companies Act clause always present (Company subject) — no isCompany toggle.",
    "Three-way audit party + reliance block reused from Format iii; 'vide my/our/their' lowercase, 'My/our/their audit' capital — kept verbatim.",
    "Statement A restructured into No./Face-value/Amount columns (source embeds these in particulars text).",
    "Statement B shareholders uses the dynamic-row table type (CA adds one row per shareholder).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

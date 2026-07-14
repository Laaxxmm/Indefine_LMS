import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format ii — Independent Practitioner's Certificate on Net worth (For VISA Application
// purpose) where no books of account have been maintained (Annexure III). Locked wording
// transcribed verbatim from the source PDF (physical pages 55–58).
// Run `npm run verify:certs -- --only ii-networth-visa`.
//
// Two independent toggles: signerType (the CA: I/we · my/our · me/us) and genderType
// (the visa applicant: Mr./Ms. · his/her · him/her). Each is asked once and drives all
// its recurrences via deriveFrom.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const gpair = (male: string, female: string) => [
  { value: "male", label: male, fragment: male },
  { value: "female", label: female, fragment: female },
];

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },

  { key: "asAtDate", label: "Net worth as-at date", type: "date", required: true, repeatKey: "ASAT", help: "fills every 'as at / as on … [date]'" },
  { key: "requestLetterDate", label: "Request letter date (para 1)", type: "date", required: true },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },
  { key: "individualName", label: "Name of the individual (applicant)", type: "text", required: true },
  { key: "individualAddress", label: "Address of the individual", type: "textarea", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "visaType", label: "Type of visa", type: "text", required: true },

  // Signer (CA) conjugation
  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },

  // Applicant gender conjugation. NOTE (reviewer): source is inconsistent — body prints
  // "Mr./ Mrs." while the enclosure/statement print "Mr./Ms."; standardised on "Mr." / "Ms.".
  { key: "genderType", label: "Applicant gender", type: "enumToggle", required: true, options: [
    { value: "male", label: "Male", fragment: "" },
    { value: "female", label: "Female", fragment: "" },
  ] },
  { key: "g_title", label: "", type: "enumToggle", deriveFrom: "genderType", options: gpair("Mr.", "Ms.") },
  { key: "g_hisher", label: "", type: "enumToggle", deriveFrom: "genderType", options: gpair("his", "her") },
  { key: "g_himher", label: "", type: "enumToggle", deriveFrom: "genderType", options: gpair("him", "her") },

  // Signature block (same as Format i)
  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },

  // Statement of Net Worth. Text columns for Identification details / Basis of valuation.
  // NOTE (reviewer): section-header rows (A. Assets / B. Liabilities) and the totals
  // (Total Assets (A), Total Liabilities (B), Net Worth (A - B)) are entered manually —
  // the table model expresses only "sumAbove", not sub-section sums or "A − B".
  { key: "netWorthTable", label: "Statement of Net Worth", type: "table", table: {
    rowLabels: ["A. Assets", "Immovable Property", "Movable Property (e.g., Vehicles)", "Bank Balances (Savings/Current/FD)", "Investments (Shares/Mutual Funds)", "Other Assets (Jewellery, etc.)", "Total Assets (A)", "B. Liabilities", "Loans (Bank/Mortgage)", "Credit Card Balances", "Other Liabilities", "Total Liabilities (B)", "Net Worth (A - B)"],
    columns: [
      { key: "ident", label: "Identification details", numeric: false },
      { key: "cost", label: "Cost (Rs.)" },
      { key: "mktval", label: "Market Value / Value considered for Net-worth (Rs.)" },
      { key: "basis", label: "Basis of valuation", numeric: false },
    ],
  } },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate on Net worth (For VISA Application purpose) as at "),
  f("asAtDate"),

  t("\n\n1. "),
  f("sg_iweCap"),
  t(" have been requested by "),
  f("g_title"),
  t(", residing at "),
  f("individualAddress"),
  t(" vide letter dated "),
  f("requestLetterDate"),
  t(" to issue Certificate on "),
  f("g_hisher"),
  t(" Net worth for VISA Application purpose. The accompanying Statement of Net worth as at "),
  f("asAtDate"),
  t(` (the "Statement") of `),
  f("g_title"),
  t(" prepared by "),
  f("g_himher"),
  t(", contains the details of "),
  f("g_hisher"),
  t(" assets and liabilities, for submission to "),
  f("authorityName"),
  t(" in connection with "),
  f("visaType"),
  t(". The Statement has been initialled by "),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nIndividual's Responsibility for the Statement\n\n2. The preparation of the accompanying Statement is the responsibility of the "),
  f("individualName"),
  t(" including the maintenance of all relevant supporting records and documents. This responsibility also includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),

  t("\n\n3. The Individual is also responsible for submitting all the details including the original deeds, documents, records of "),
  f("g_hisher"),
  t(" assets and liabilities as at "),
  f("asAtDate"),
  t(` ("details").`),

  t("\n\nPractitioner's Responsibility\n\n4. Pursuant to the requirements of VISA application, it is "),
  f("sg_myour"),
  t(" responsibility to provide limited assurance as to whether the Statement presented to "),
  f("sg_meus"),
  t(" is in agreement with the details referred in paragraph 3 above."),

  t("\n\n5. The procedures performed in a limited assurance engagement vary in nature and timing from, and are less in extent than for, a reasonable assurance engagement; and consequently, the level of assurance obtained in a limited assurance engagement is substantially lower than the assurance that would have been obtained had a reasonable assurance engagement been performed. Accordingly, "),
  f("sg_iwe"),
  t(" have performed the following procedures in relation to the Statement presented to "),
  f("sg_meus"),
  t(":\na) Obtained documents viz. original deeds / valuation report to verify the value of property (residential flat/ commercial property, i.e. immoveable property, if any) forming part of the net assets.\nb) Obtained invoices and bank statements to verify the value of movable property.\nc) Obtained bank statements to verify the bank balances in savings/ current accounts, fixed deposits.\nd) Obtained demat statement of the depository, to verify the investments held in the nature of the shares / mutual funds.\ne) Obtained valuation report (if any), of the Jewellery mentioned in the statement, to verify the value of the same.\nf) Obtained the loan statements to verify the loan from Bank including mortgage, forming part of liabilities.\ng) Obtained the Credit Card balance statements to verify the credit card related liability.\nh) "),
  f("sg_iweCap"),
  t(" have obtained confirmations from the parties mentioned in the loan given to (assets)/ loan taken from (liabilities), in the statement.\ni) Performed necessary inquiries with the Individual and obtained necessary clarification, from the individual.\n"),
  f("sg_iweCap"),
  t(" have relied upon the information and supporting details furnished in substantiation of the statement"),

  t("\n\n6. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(` examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the Institute of Chartered Accountants of India ("ICAI"). The Guidance Note requires that `),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements."),

  t("\n\nConclusion\n\n8. Based on the procedures carried out as mentioned above, and according to the information and explanations given to "),
  f("sg_meus"),
  t(", nothing has come to "),
  f("sg_myour"),
  t(" attention that causes "),
  f("sg_meus"),
  t(" to believe that the particulars mentioned in the Statement, which is prepared by "),
  f("g_title"),
  t(" "),
  f("individualName"),
  t(" and initialled by "),
  f("sg_meus"),
  t(" for identification purpose, is not in accordance with the documentary evidence made available for verification as set out in paragraph 5 above."),

  t("\n\nRestriction on Use\n\n9. This Certificate has been issued at the request of the "),
  f("individualName"),
  t(" solely for the purpose of submission to "),
  f("authorityName"),
  t(" for visa application purposes. This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
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
  t("\n\nEnclosure: Statement of Net Worth of "),
  f("g_title"),
  t(" "),
  f("individualName"),
  t(" as on "),
  f("asAtDate"),

  // Statement of Net Worth
  t("\n\nStatement of Net Worth of "),
  f("g_title"),
  t(" "),
  f("individualName"),
  t(" as on "),
  f("asAtDate"),
  f("netWorthTable"),
  t("This Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatII: CertificateTemplate = {
  id: "ii-networth-visa",
  romanNo: "ii",
  title: "Independent Practitioner's Certificate on Net worth (For VISA Application purpose)",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [55, 58],
  hash: "ab1014382d9ceb0bc5893a4f245994f09832e83e87139dbebdf3fba5b7a744bd", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["netWorthTable"],
  notes: [
    "Applicant title standardised to 'Mr.' / 'Ms.' (source mixes 'Mrs.' in the body and 'Ms.' in the statement).",
    "Net-worth table: section-header rows and the A/B totals + 'Net Worth (A − B)' are manual (model only expresses sumAbove).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

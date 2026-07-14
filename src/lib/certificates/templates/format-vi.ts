import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format vi — Independent Practitioner's Certificate on Indian Income Tax Return
// Acknowledgement (Annexure III). Locked wording transcribed verbatim from the source
// PDF (pages 73–76). Run `npm run verify:certs -- --only vi-itr-v`.
//
// Toggles: signerType (CA), engagerType (Mr./Ms./M/s of the engaging authority), and
// assesseeType (his/her/its + he/she/it). The leading editorial "[In case...]" note is
// guidance, not certificate text, so it is not transcribed.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];
const gtriple = (male: string, female: string, entity: string) => [
  { value: "male", label: male, fragment: male },
  { value: "female", label: female, fragment: female },
  { value: "entity", label: entity, fragment: entity },
];

const fields: FieldDef[] = [
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "assessmentYear", label: "Assessment Year (e.g. 2024-25)", type: "text", required: true, repeatKey: "AY", help: "fills every AY 20XX-XX" },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "engagingAuthorityName", label: "Name of the engaging authority", type: "text", required: true },
  { key: "assesseeName", label: "Name of the Assessee", type: "text", required: true },
  { key: "authorityName", label: "Name of the authority (submission)", type: "text", required: true },
  { key: "assesseePAN", label: "Assessee PAN", type: "text", required: true },
  { key: "downloadDate", label: "Date of download (para 8)", type: "date", required: true },
  { key: "acknowledgementNo", label: "ITR-V acknowledgement number", type: "text", required: true },
  { key: "acknowledgementDate", label: "Acknowledgement / filing date", type: "date", required: true },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },

  { key: "engagerType", label: "Engaging authority is", type: "enumToggle", required: true, options: [
    { value: "male", label: "Mr.", fragment: "" },
    { value: "female", label: "Ms.", fragment: "" },
    { value: "entity", label: "M/s (firm/company)", fragment: "" },
  ] },
  { key: "engagerTitle", label: "", type: "enumToggle", deriveFrom: "engagerType", options: gtriple("Mr.", "Ms.", "M/s") },

  { key: "assesseeType", label: "Assessee is", type: "enumToggle", required: true, options: [
    { value: "male", label: "Individual (male)", fragment: "" },
    { value: "female", label: "Individual (female)", fragment: "" },
    { value: "entity", label: "Entity", fragment: "" },
  ] },
  { key: "a_hisherits", label: "", type: "enumToggle", deriveFrom: "assesseeType", options: gtriple("his", "her", "its") },
  { key: "a_hesheit", label: "", type: "enumToggle", deriveFrom: "assesseeType", options: gtriple("he", "she", "it") },

  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Practitioner's Certificate on Indian Income Tax Return Acknowledgement for the AY "),
  f("assessmentYear"),

  t("\n\n1. This Certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter/agreement dated "),
  f("engagementLetterDate"),
  t(".\n\n2. "),
  f("sg_iweCap"),
  t(" have been engaged by "),
  f("engagerTitle"),
  t(" "),
  f("engagingAuthorityName"),
  t(" to issue this certificate related to Indian Income Tax Return Acknowledgement for the Assessment Year "),
  f("assessmentYear"),
  t(" of "),
  f("assesseeName"),
  t(` ("the Assessee"), for submission to `),
  f("authorityName"),
  t(". The Indian Income Tax Return Acknowledgement has been initialled by "),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nAssessee's Responsibility\n\n3. The Assessee is responsible for preparation and filing of "),
  f("a_hisherits"),
  t(" income-tax return with the Income Tax Department through the e-filing portal of the Income Tax Department. The preparation and filing of ITR by the Assessee for the Assessment Year "),
  f("assessmentYear"),
  t(" is the responsibility of "),
  f("assesseeName"),
  t(". This responsibility includes the preparation and maintenance of all accounting (if applicable) and other relevant supporting records and documents. This responsibility also includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the income tax return and applying an appropriate basis of preparation; and making estimates that are appropriate in the circumstances."),

  t("\n\n4. The Assessee is also responsible for ensuring that "),
  f("a_hesheit"),
  t(" has complied with the requirements of the Income-tax Act, 1961 and the relevant rules and notifications thereunder to disclose all the incomes and other details which are true and correct as required under law while preparing, computing and filing of the income for Assessment Year "),
  f("assessmentYear"),
  t("."),

  t("\n\nPractitioner's Responsibility\n\n5. It is "),
  f("sg_myour"),
  t(" responsibility to examine the downloading of the Indian Income Tax Return Acknowledgement of the Assessee for the Assessment Year "),
  f("assessmentYear"),
  t(" from the Income tax e-filing portal where the assessee has filed "),
  f("a_hisherits"),
  t(" Income Tax Return."),

  t("\n\n6. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(` examination of the downloading of Indian Income Tax Return Acknowledgement in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the Institute of Chartered Accountants of India ("ICAI"). The Guidance Note requires that `),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements."),

  t("\n\nOpinion\n\n8. Based on "),
  f("sg_myour"),
  t(" examination of the downloading, as above, and the information and explanations given to "),
  f("sg_meus"),
  t(", "),
  f("sg_iwe"),
  t(" report that the Indian Income Tax Return Acknowledgement as annexed to this report is downloaded in "),
  f("sg_myour"),
  t(" presence, by the Assessee, from the Income Tax Department website (https://www.incometax.gov.in/iec/foportal/) from the login of the Assessee "),
  f("assesseeName"),
  t(" having PAN "),
  f("assesseePAN"),
  t(" for Assessment Year "),
  f("assessmentYear"),
  t(" on "),
  f("downloadDate"),
  t(", having acknowledgement no. "),
  f("acknowledgementNo"),
  t(" dated "),
  f("acknowledgementDate"),
  t("."),

  t("\n\nRestriction on Use\n\n9. This Certificate has been issued at the request of the Engaging Authority for submission to "),
  f("authorityName"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block (Format vi labels: "Registration No…", "Membership No" without colon)
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
  t("\n\nEnclosure: ITR V -Indian Income Tax Return Acknowledgement of "),
  f("assesseeName"),

  // ITR V statement page
  t("\n\nITR V\n\nAcknowledgement No.: "),
  f("acknowledgementNo"),
  t("   Date of filing: "),
  f("acknowledgementDate"),
  t("\n\nThis ITR V is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Practitioner"),
];

export const formatVI: CertificateTemplate = {
  id: "vi-itr-v",
  romanNo: "vi",
  title: "Independent Practitioner's Certificate on Indian Income Tax Return Acknowledgement",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [73, 76],
  hash: "6c660dd26a643cc2faecf4b81526e7cc54907c8f0d4f945c5120f5ac64756370", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  notes: [
    "Leading editorial note '[In case a Practitioner is required...]' is guidance, not certificate text — not transcribed.",
    "Engaging-authority title = Mr./Ms./M/s; assessee pronouns = his/her/its + he/she/it (two independent 3-way toggles).",
    "Assessment Year is a single text field (e.g. '2024-25') filling AY 20XX-XX everywhere.",
    "Para 8 editorial hints '(name)' '(PA No.)' '(date of download)' are replaced by the real login name / PAN / date fields (hint text dropped).",
    "ITR-V 'Date of filing' reuses the acknowledgement date field; dates render as 'D Month YYYY' (not the source's DD-MM-YYYY numeric style).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

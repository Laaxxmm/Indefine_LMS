import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format xi — Independent Auditor's Certificate on the proposed accounting treatment in
// the Draft Scheme of Merger and Amalgamation / Demerger (Annexure III). Locked wording
// transcribed verbatim from the source PDF (pages 95–99). No tables.
// Run `npm run verify:certs -- --only xi-proposed-dividend`.
//
// The source's SQUARE-BRACKET signature labels ("For [FIRM/INDIVIDUAL]",
// "[Firm's Registration No. …]") are dropped — brackets are placeholders, and the leak
// guard forbids "[" / "]" in output. Strike-off authority menus collapse to one text field.

const pair = (firm: string, individual: string) => [
  { value: "firm", label: firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];

const fields: FieldDef[] = [
  { key: "transfereeCompanyName", label: "Transferee / addressee Company name", type: "text", required: true, repeatKey: "TRANSFEREE" },
  { key: "transfereeRegdOffice", label: "Registered office address", type: "textarea", required: true },
  { key: "transferorCompanyName", label: "Transferor Company(ies) name", type: "text", required: true },
  { key: "schemeClause", label: "Clause of the Draft Scheme (accounting treatment)", type: "text", required: true, repeatKey: "CLAUSE" },
  { key: "schemePart", label: "Part of the Draft Scheme", type: "text", required: true, repeatKey: "PART" },
  { key: "submissionTarget", label: "Submission target (Stock Exchange / SEBI / ROC / NCLT / Tribunal)", type: "text", required: true, repeatKey: "TARGET", help: "Enter the applicable authority — the source lists options to 'strike off whichever is not applicable'." },
  { key: "schemeApprovalDates", label: "Board approval date(s) (transferee & transferor)", type: "text", required: true, help: "e.g. 10 April 2025 and 12 April 2025" },
  { key: "appointedDate", label: "Appointed date of the Proposed Scheme", type: "date", required: true, repeatKey: "APPOINTED" },
  { key: "engagementLetterDate", label: "Engagement letter date", type: "date", required: true },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("our", "my") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("us", "me") },
  { key: "sg_amare", label: "", type: "enumToggle", deriveFrom: "signerType", options: pair("are", "am") },

  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signing", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin" },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\nThe Board of Directors\n"),
  f("transfereeCompanyName"),
  t("\n"),
  f("transfereeRegdOffice"),

  t("\n\nIndependent Auditor's Certificate on the proposed accounting treatment contained in books of "),
  f("transfereeCompanyName"),
  t(" as specified in the Draft Scheme of Merger and Amalgamation/ Demerger"),

  t("\n\n1. This certificate is issued in accordance with the terms of "),
  f("sg_myour"),
  t(" engagement letter dated "),
  f("engagementLetterDate"),
  t("."),

  t("\n\n2. "),
  f("sg_iweCap"),
  t(" have been requested by the management/Board of Directors of "),
  f("transfereeCompanyName"),
  t(` (hereinafter the "Company" or "Transferee Company"), having its registered office at `),
  f("transfereeRegdOffice"),
  t(" to certify that the proposed accounting treatment contained in Clause"),
  t(" "),
  f("schemeClause"),
  t(" of Part "),
  f("schemePart"),
  t(" of the Draft Scheme of Merger and Amalgamation/Demerger of "),
  f("transferorCompanyName"),
  t(` (hereinafter the "Transferor Company") and `),
  f("transfereeCompanyName"),
  t(` and their respective Shareholders and Creditors, (hereinafter referred to as the "Draft Scheme") in terms of the provisions of section 230 to 232 of the Companies Act, 2013 is in is in compliance with the applicable Accounting Standards specified under Section 133 of the Companies Act, 2013, read with relevant rules issued thereunder and other generally accepted accounting principles for the purpose of onward submission to `),
  f("submissionTarget"),
  t(". The Proposed Scheme is approved by the Board of Directors of the Transferee Company and the Transferor Company (ies) on "),
  f("schemeApprovalDates"),
  t(" respectively and is subject to approval of the NCLT and Statutory and Regulatory Authorities, as applicable. The appointed date for the purpose of the Proposed Scheme is "),
  f("appointedDate"),
  t(".The relevant extract of the scheme as referred above is enclosed as Annexure and initialled by "),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nManagement's Responsibility\n\n3. The preparation of the Draft Scheme and its compliance with the relevant provisions of the Act, laws and regulations, including the applicable Accounting Standards, rules made and issued thereunder and the Generally Accepted Accounting Principles in India, is the responsibility of the management/Board of Directors of the Companies including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Draft Scheme and applying an appropriate basis of preparation and making estimates that are reasonable in the circumstances."),

  t("\n\n4. The Management is also responsible for ensuring that the Company complies with the requirements of sections 230-232 of the Companies Act, 2013 and provides all relevant information with respect to the draft scheme to "),
  f("submissionTarget"),
  t("."),

  t("\n\nAuditor's Responsibility\n\n5. Pursuant to the requirements of sections 230-232 of the Companies Act, 2013, "),
  f("sg_myour"),
  t(" responsibility is to provide a reasonable assurance whether the proposed accounting treatment specified in Clause"),
  t(" "),
  f("schemeClause"),
  t(" of Part "),
  f("schemePart"),
  t(" of the Draft Scheme is in compliance with the applicable Accounting Standards specified under Section 133 of the Companies Act, 2013, read with relevant rules issued thereunder and other generally accepted accounting principles."),

  t("\n\n6. The following documents and details, inter alia, have been furnished to "),
  f("sg_meus"),
  t(" by the Company:\na) Copy of the Draft Scheme of the Company along with the date from which the draft scheme shall be effective;\nb) Certified true copy of the board resolution for the proposed amalgamation/merger/ demerger; and\nc) Written representation from the Management in this regard."),

  t("\n\n7. "),
  f("sg_iweCap"),
  t(" conducted "),
  f("sg_myour"),
  t(" examination of the proposed accounting treatment specified in Clause"),
  t(" "),
  f("schemeClause"),
  t(" of Part "),
  f("schemePart"),
  t(` of the Draft Scheme in accordance with the Guidance Note on Reports or Certificates for Special Purposes (Revised 2016) issued by the Institute of Chartered Accountants of India ("ICAI"). The Guidance Note requires that `),
  f("sg_iwe"),
  t(" comply with the ethical requirements of the Code of Ethics issued by the ICAI."),

  t("\n\n8. "),
  f("sg_iweCap"),
  t(" have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements issued by ICAI."),

  t("\n\nOpinion\n\n9. As per Section 232(6) of the Companies Act, 2013 the Draft Scheme has to provide for the appointed date from which the Draft Scheme shall be deemed to be effective. The Company has accordingly proposed the appointed date as "),
  f("appointedDate"),
  t(" in the Draft Scheme.\n\nBased on "),
  f("sg_myour"),
  t(" examination, as above, and the information and explanations given to "),
  f("sg_meus"),
  t(", "),
  f("sg_iwe"),
  t(" "),
  f("sg_amare"),
  t(" of the opinion that the proposed accounting treatment specified in Clause"),
  t(" "),
  f("schemeClause"),
  t(" of Part "),
  f("schemePart"),
  t(" of the Draft Scheme, to the extent applicable to the Company and as on the effective date of the Draft Scheme, is in compliance with the applicable Accounting Standards specified under Section 133 of the Companies Act, 2013, read with relevant rules issued thereunder and other generally accepted accounting principles."),

  t("\n\nRestriction on Use\n\n10. The certificate is issued solely issued at the request of the Management of the Company pursuant to requirements of proviso to Section 232(3) and circulars issued under SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015 for submission to "),
  f("submissionTarget"),
  t(". This Certificate should not be used for any other purpose or by any person other than the addressee of this Certificate. Accordingly, "),
  f("sg_iwe"),
  t(" do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this Certificate is shown or into whose hands it may come without "),
  f("sg_myour"),
  t(" prior consent in writing."),

  // Signature block — square-bracket labels in the source are dropped (see file header).
  t("\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n"),
  // split here: source has "Chartered Accountants [Firm's Registration No. …]"; the "["
  // (dropped) must fall in the gap, not inside a locked segment.
  t("Firm's Registration No. "),
  f("firmRegistrationNumber"),
  t("\n\nSignature\n"),
  f("memberName"),
  t("\n"),
  f("designation"),
  t("\nMembership No. "),
  f("membershipNo"),
  t("\nPlace of signing "),
  f("placeOfSignature"),
  t("\nUDIN: "),
  f("udin"),
  t("\nDate: "),
  f("certificateDate"),

  // Enclosure + Annexure page
  t("\n\nEnclosure: Annexure: Extracts of the Scheme of Merger and Amalgamation/ Demerger"),
  t("\n\nAnnexure : Extracts of the Scheme of Merger and Amalgamation/ Demerger\nThis Annexure is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Auditor"),
];

export const formatXI: CertificateTemplate = {
  id: "xi-proposed-dividend",
  romanNo: "xi",
  title: "Independent Auditor's Certificate on the proposed accounting treatment in the Draft Scheme of Merger and Amalgamation / Demerger",
  version: "2025.10.0",
  status: "enabled",
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [95, 99],
  hash: "e425e0cae601ff2b6371264547bdf24052aa1f2e23f4e0a8e5b76f53c205a454", // §6.5 — pinned after clean text pass
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  notes: [
    "Registry id 'xi-proposed-dividend' kept (spec §5 slug); actual format is the merger-scheme accounting-treatment certificate.",
    "Source square-bracket signature labels dropped (leak guard forbids brackets in output); FRN rendered as 'Firm's Registration No. <n>'.",
    "Strike-off authority menus (para 2/4/10) collapse to one submissionTarget text field.",
    "Source typos kept verbatim: 'is in is in compliance' (para 2), 'issued solely issued' (para 10).",
    "schemeClause / schemePart / appointedDate reused across paragraphs; schemeApprovalDates is free text (plural board dates).",
    "firmName/firmRegistrationNumber always-required (see Format i note).",
  ],
};

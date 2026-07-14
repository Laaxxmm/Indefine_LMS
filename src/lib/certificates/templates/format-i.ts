import type { CertificateTemplate, FieldDef, Segment } from "../types";

// Format i — Independent Auditor's Certificate on the Statement of Unhedged Foreign
// Currency Exposure (UFCE) + EBID (Annexure III). Locked wording transcribed verbatim
// from the source PDF (physical pages 49–54). Run `npm run verify:certs -- --only i-ufce`.
//
// Signer conjugation: one user choice `signerType` (Firm | Individual) drives every
// I/we · my/our · me/us · am/are recurrence via derived fields (deriveFrom), so the
// user is asked ONCE. Capitalised variants exist for sentence-initial spots.

const signerOptions = (firm: string, individual: string) => [
  { value: "firm", label: individual === "I" ? "we" : firm, fragment: firm },
  { value: "individual", label: individual, fragment: individual },
];

const fields: FieldDef[] = [
  // Addressee / entity / dates
  { key: "appointingAuthorityName", label: "Appointing authority — name", type: "text", required: true, help: "[Name of the Appointing Authority]" },
  { key: "appointingAuthorityAddress", label: "Appointing authority — address", type: "textarea", required: true },
  { key: "entityName", label: "Entity name", type: "text", required: true },
  { key: "entityRegdOffice", label: "Entity — registered office address", type: "textarea", required: true },
  { key: "engagementLetterDate", label: "Engagement letter/agreement date", type: "date", required: true },
  { key: "auditReportDate", label: "Audit report date (para 6)", type: "date", required: true },
  { key: "bankName", label: "Bank / authorized dealer (restriction-on-use)", type: "text", required: true },
  { key: "fyEndYear", label: "Financial year-end year (fills every 'March 31, 20XX')", type: "year", required: true, repeatKey: "FYEND", help: "e.g. 2025" },

  // Signer type + derived grammatical conjugations (all keyed to signerType)
  { key: "signerType", label: "Signing as", type: "enumToggle", required: true, help: "Firm (we/our) or Individual (I/my)", options: [
    { value: "firm", label: "Firm", fragment: "" },
    { value: "individual", label: "Individual", fragment: "" },
  ] },
  { key: "sg_iwe", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("we", "I") },
  { key: "sg_iweCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("We", "I") },
  { key: "sg_myour", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("our", "my") },
  { key: "sg_myourCap", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("Our", "My") },
  { key: "sg_meus", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("us", "me") },
  { key: "sg_amare", label: "", type: "enumToggle", deriveFrom: "signerType", options: signerOptions("are", "am") },

  // Legal choices
  { key: "auditOpinion", label: "Audit opinion (para 6)", type: "enumToggle", required: true, options: [
    { value: "unmodified", label: "Unmodified", fragment: "unmodified" },
    { value: "modified", label: "Modified", fragment: "modified" },
  ] },
  { key: "isCompany", label: "Entity is a Company", type: "boolToggle", required: true, help: "Retains the s.143(10) Companies Act clause", onText: ", as specified under section 143(10) of the Companies Act, 2013", offText: "" },
  { key: "preparesConsolidatedFS", label: "Entity prepares consolidated financial statements", type: "boolToggle", required: true, help: "Inserts 'Standalone' before 'Financial Statements'", onText: "Standalone ", offText: "" },

  // Signature block
  // NOTE (reviewer): §4 marked firmName / firmRegistrationNumber requiredWhen=firm. Kept
  // as always-required — every ICAI practitioner (incl. proprietors) signs under a firm
  // name + FRN, and an empty "For " line would be a dangling placeholder. Confirm on sign-off.
  { key: "firmName", label: "Firm name (above 'Chartered Accountants')", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "memberName", label: "Name of the member signing", type: "text", required: true },
  { key: "designation", label: "Designation (Partner / Proprietor)", type: "text", required: true },
  { key: "membershipNo", label: "Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place of signature", type: "text", required: true },
  { key: "udin", label: "UDIN (paste from ICAI portal — never generated)", type: "udin", required: true, validate: "udin", help: "18 chars, ^[0-9A-Z]{18}$" },
  { key: "certificateDate", label: "Certificate date", type: "date", required: true },

  // Statement footer identity
  { key: "authorisedSignatoryName", label: "Authorised Signatory (Statement)", type: "text", required: true },
  { key: "statementPlace", label: "Statement — Place", type: "text", required: true },
  { key: "statementDate", label: "Statement — Date", type: "date", required: true },

  // Statement A — Unhedged Foreign Currency Exposure (7 columns confirmed against the PDF grid)
  { key: "ufceTable", label: "Statement A — Unhedged Foreign Currency Exposure (INR crores)", type: "table", table: {
    rowLabels: ["FCY Receivables", "Exports", "Loans to JV/WOS", "Others", "FCY Payables", "Imports", "Trade Credits", "ECBs", "Other FCY loans", "INR to USD swaps", "Total"],
    columns: [
      { key: "u_le1", label: "Unhedged ≤1 year" },
      { key: "u_gt1", label: "Unhedged >1 year" },
      { key: "u_tot", label: "Unhedged Total" },
      { key: "h_le1", label: "Hedged ≤1 year" },
      { key: "h_gt1", label: "Hedged >1 year" },
      { key: "h_tot", label: "Hedged Total" },
      { key: "n_le1", label: "Natural Hedge ≤1 year" },
    ],
  } },

  // Statement B — EBID. Row 1's source label carries the FY ("...year ended March 31, 20XX");
  // the year is already stated in the Statement B heading, so it is trimmed here to keep 20XX
  // out of output. Last row is the deterministic sum of the four above (§4).
  { key: "ebidTable", label: "Statement B — EBID (Amount in Rs)", type: "table", table: {
    rowLabels: ["Profit/ Loss after tax for the year", "Add: Depreciation and Amortisation expense", "Add: Interest on Debt*", "Add: Lease Rentals", "Earning before interest and depreciation"],
    columns: [{ key: "amount", label: "Amount (In Rs)" }],
    computedRows: [{ rowIndex: 4, formula: "sumAbove" }],
  } },

  // Optional parent-hedge note (default OFF). "our" kept locked per source — flagged for review.
  { key: "parentHedgeNote", label: "Optional: parent-entity hedge note", type: "optionalBlock",
    subFields: [
      { key: "parentHedgeAmount", label: "UFCE amount hedged by parent (Rs.)", type: "number", required: true },
      { key: "parentHedgeLetterDate", label: "Parent letter date", type: "date", required: true },
    ],
    subSegments: [
      { kind: "text", text: "We would like to mention that UFCE to the tune of Rs. " },
      { kind: "field", key: "parentHedgeAmount" },
      { kind: "text", text: " Has not been included in our unhedged position since the exposure is being hedged and managed by our parent entity as explained in detail in our letter dated " },
      { kind: "field", key: "parentHedgeLetterDate" },
    ],
  },
];

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const segments: Segment[] = [
  t("To\n"),
  f("appointingAuthorityName"),
  t("\n"),
  f("appointingAuthorityAddress"),
  t("\n\nIndependent Auditor's Certificate on the Statement of Unhedged Foreign Currency Exposure as at March 31, "),
  f("fyEndYear"),
  t(" and Earnings before Interest and Depreciation (EBID) for the year ended March 31, "),
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
  t(` to certify the particulars stated in the Statement of the Unhedged Foreign Currency Exposure ("UFCE") of the entity as at March 31, `),
  f("fyEndYear"),
  t(` and the Earnings Before Interest and Depreciation ("EBID") of the entity for the year ended March 31, `),
  f("fyEndYear"),
  t(` ("the Statement") in accordance with the Reserve Bank of India (Unhedged Foreign Currency Exposure) Directions, 2022 vide RBI/2022-23/131 DOR.MRG.REC.76/00-00-007/2022-23 dated October 11, 2022 ("RBI direction") in the format specified by the special circular SBL-0.5.BC/UFCE Format / 2018 dated May 17, 2018 issued by Foreign Exchange Dealers Association of India ("FEDAI"). The Statement has been initialled by `),
  f("sg_meus"),
  t(" for identification purposes only."),

  t("\n\nManagement's Responsibility\n\n3. The preparation of the Statement is the responsibility of the Management of the entity including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility also includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation; and making estimates that are reasonable in the circumstances."),
  t("\n\n4. The Management is also responsible for ensuring that the entity complies with the requirements of the applicable RBI Directions relating to foreign exchange management including the hedging or entering into derivative contracts against the underlying exposures."),

  t("\n\nAuditor's Responsibility\n\n5. Pursuant to the requirement as laid down in RBI Direction, it is "),
  f("sg_myour"),
  t(" responsibility to provide a reasonable assurance whether:\n(a) the information stated in the Statement have been extracted from the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements of the entity for the year ended March 31, "),
  f("fyEndYear"),
  t(";\n(b) the amounts that form part of EBID computation have been extracted from the audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements of the entity for the year ended March 31, "),
  f("fyEndYear"),
  t(" and the computation of EBID is in accordance with the RBI Direction."),

  t("\n\n6. The "),
  f("preparesConsolidatedFS"),
  t("Financial Statements for the financial year ended March 31, "),
  f("fyEndYear"),
  t(" referred to in paragraph 5 above, have been audited by "),
  f("sg_meus"),
  t(", on which "),
  f("sg_iwe"),
  t(" issued an "),
  f("auditOpinion"),
  t(" audit opinion vide "),
  f("sg_myour"),
  t(" report dated "),
  f("auditReportDate"),
  t(". "),
  f("sg_myourCap"),
  t(" audit of these financial statements was conducted in accordance with the Standards on Auditing"),
  f("isCompany"),
  t(` and other applicable authoritative pronouncements issued by the Institute of Chartered Accountants of India ("ICAI").Those standards require that `),
  f("sg_iwe"),
  t(" plan and perform the audit to obtain reasonable assurance about whether the financial statements are free of material misstatement."),

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
  t(" "),
  f("sg_amare"),
  t(" of the opinion that:\n(a) the amounts in the accompanying Statement of the entity as at March 31, "),
  f("fyEndYear"),
  t(" are extracted from audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements of the entity for the year ended March 31, "),
  f("fyEndYear"),
  t(" and\n(b) the amount of EBID of the entity for the year ended March 31, "),
  f("fyEndYear"),
  t(" is extracted from audited "),
  f("preparesConsolidatedFS"),
  t("Financial Statements of the entity for the year ended March 31, "),
  f("fyEndYear"),
  t(" and the computation of EBID is in accordance with the RBI Direction."),

  t("\n\nRestriction on Use\n\n10. This Certificate has been issued at the request of the Management of the entity for submission by the entity to "),
  f("bankName"),
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

  // Enclosure list
  t("\n\nEnclosure: Statement of:\nA. Unhedged Foreign Currency Exposure for the year ended March 31, "),
  f("fyEndYear"),
  t(" in accordance with the Reserve Bank of India (Unhedged Foreign Currency Exposure) Directions, 2022 vide RBI/2022-23/131 DOR.MRG.REC.76/00-00-007/2022-23 dated October 11, 2022\nB. Earnings before Interest and Depreciation (EBID) for the year ended March 31, "),
  f("fyEndYear"),
  t(" in accordance with the Reserve Bank of India (Unhedged Foreign Currency Exposure) Directions, 2022 vide RBI/2022-23/131 DOR.MRG.REC.76/00-00-007/2022-23 dated October 11, 2022"),

  // Statement A
  t("\n\nStatement of\nA. Unhedged Foreign Currency Exposure for the year ended March 31, "),
  f("fyEndYear"),
  t(" in accordance with the Reserve Bank of India (Unhedged Foreign Currency Exposure) Directions, 2022 vide RBI/2022-23/131 DOR.MRG.REC.76/00-00-007/2022-23 dated October 11, 2022\nQuarterly Data on Foreign Currency Exposures"),
  f("ufceTable"),
  t("#Note: Covered Option(s) is/are not included\nWe declare that all the derivative contracts considered as hedging contracts are in conformity of pronouncement of the Institute of Chartered Accountants in respect of their hedge effectiveness vis-a-vis the underlying exposure."),
  f("parentHedgeNote"),
  t("Yours sincerely\nAuthorised Signatory "),
  f("authorisedSignatoryName"),
  // Source statement footer reads "Place…" / "Date…" (ellipsis placeholder, no colon);
  // keep the label locked and add ": " as presentational glue.
  t("\nPlace"),
  t(": "),
  f("statementPlace"),
  t("\nDate"),
  t(": "),
  f("statementDate"),
  t("\nThis Statement is initialed for identification purposes only and should be read along with Certificate dated "),
  f("certificateDate"),
  t("\nSignature and stamp of the Auditor"),

  // Statement B
  t("\n\nB. Earnings before Interest and Depreciation (EBID) for the year ended March 31, "),
  f("fyEndYear"),
  t(" in accordance with the Reserve Bank of India (Unhedged Foreign Currency Exposure) Directions, 2022 vide RBI/2022-23/131 DOR.MRG.REC.76/00-00-007/2022-23 dated October 11, 2022"),
  f("ebidTable"),
  t(`* Interest on debt includes interest on lease liability\n"Earnings before Interest and Depreciation (EBID)" as defined in the RBI Direction, shall have the same meaning as defined for computation of Debt Service Coverage Ratio (DSCR) i.e., EBID = Profit After Tax + Depreciation + Interest on debt + Lease Rentals, if any.\nThis Statement is initialed for identification purposes only and should be read along with Certificate dated `),
  f("certificateDate"),
  t("\nSignature and stamp of the Auditor"),
];

export const formatI: CertificateTemplate = {
  id: "i-ufce",
  romanNo: "i",
  title: "Independent Auditor's Certificate on the Statement of Unhedged Foreign Currency Exposure",
  version: "2025.10.0",
  status: "enabled", // enable only after verifier passes AND a human sets verifiedBy (§12.5)
  sourcePdf: "src/lib/certificates/source/Certifications_guidebook_ICAI.pdf",
  sourcePages: [49, 54],
  hash: "0e536eb34a8f5a73e6eb1f5f1898ed2c28198894a3e5ed20e39a67d061afe9cb", // §6.5 — pinned after a clean text pass; re-pin only on a reviewed wording change
  verifiedBy: "Rajkumar Annamalai",
  verifiedAt: "2026-07-14",
  fields,
  segments,
  tables: ["ufceTable", "ebidTable"],
  notes: [
    "firmName/firmRegistrationNumber made always-required (§4 said requiredWhen firm) — see field note.",
    "preparesConsolidatedFS renders only 'Standalone'; the ICAI editorial parenthetical '(where the entity prepares consolidated financial statements)' is intentionally omitted from output.",
    "EBID row 1 label trimmed of the trailing 'for the year ended March 31, 20XX' (year is in the Statement B heading) to keep 20XX out of output.",
    "UFCE grid uses flat column labels; the PDF shows grouped headers (Unhedged / Hedged / Natural Hedge). Confirm the Natural-Hedge single-column reading on sign-off.",
    "parentHedgeNote keeps 'our' (unhedged position / parent entity / letter) as locked per source; not conjugated to signerType.",
  ],
};

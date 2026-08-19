import type { CertificateTemplate, FieldDef, Segment } from "../types";

// The firm's Independent Auditors' Report, ported from its three Word templates
// (WITHOUT CFS / WITH CFS / WITH CFS and CARO, 2025). Those three files are one report
// with three switches, so this is one template: `hasCFS` swaps the four spans that mention
// the Cash Flow Statement, `caroApplicable` swaps paragraph 6 A) and turns on Annexure A,
// and `ifcReporting` swaps clause vi) and turns on Annexure B. Everything else is identical
// across the three files. Unlike formats i–xii this is firm text, not an ICAI illustrative
// format, so it has no source PDF page range to verify against.

const f = (key: string): Segment => ({ kind: "field", key });
const t = (text: string): Segment => ({ kind: "text", text });

const bodySegments: Segment[] = [
  t("INDEPENDENT AUDITORS’ REPORT\n\nTo:\nThe Members of "),
  f("entityName"),
  t("\n\nReport on the audit of the financial statements\n\n1. Opinion\nWe have audited the accompanying financial statements of "),
  f("entityName"),
  t(" (“the Company”), which comprise of the Balance Sheet as at 31st March, "),
  f("fyEndYear"),
  f("cfsOpinionScope"),
  t(" for the year ended on that date together with the Notes to the financial statements including a summary of significant accounting policies and other explanatory information related thereto.\n\nIn our opinion and to the best of our information and according to the explanations given to us, the aforesaid financial statements give the information required by the Companies Act, 2013, in the manner so required and give a true and fair view in conformity with the accounting principles generally accepted in India, of the state of affairs of the Company as at 31st March, "),
  f("fyEndYear"),
  f("cfsOpinionResult"),
  t(" for the year ended on that date.\n\n2. Basis for our opinion\nWe conducted our audit of the aforesaid financial statements in accordance with the Standards on Auditing (SAs) as specified under Section 143(10) of the Act. Our responsibilities under those Standards are further described in the ‘Auditor’s Responsibilities for the Audit of the financial statements’ section of our report. We are independent of the Company in accordance with the ‘Code of Ethics’ issued by the Institute of Chartered Accountants of India together with the ethical requirements that are relevant to our audit of the financial statements under the provisions of the Act and the Rules thereunder and we have fulfilled our other ethical responsibilities in accordance with these requirements and the said Code of Ethics. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion on the said financial statements.\n\n3. Information other than the financial statements and relevance of auditors’ report thereon\nThe Company’s Board of Directors (viz., the Management) is responsible for the preparation of the other information. The other information comprises of the information included in the Annual/Board’s Report but does not include these financial statements and our Auditor’s report thereon.\n\nOur opinion on the financial statements does not cover the other information and we do not express any form of assurance or conclusion thereon.\n\nIn connection with our audit of the financial statements, our responsibility is to read the other information, wherever applicable and, in doing so, consider whether the other information is materially inconsistent with the said financial statements or with our knowledge obtained during the course of our audit or otherwise appears to be materially mis-stated. If, based on the work we have performed, we conclude that there is a material mis-statement of this other information, we are required to report that fact. We have however nothing to report here in this regard.\n\n4. Management’s Responsibility for the financial statements\nThe Company’s Board of Directors (viz., the Management) is responsible for the matters stated in Section 134(5) of the Act with respect to the preparation and presentation of these financial statements that give a true and fair view of the "),
  f("cfsMgmtResponsibility"),
  t(" of the Company in accordance with the accounting principles generally accepted in India, including the Companies (Accounting Standards) Rules, 2006 (as amended) specified under Section 133 of the Act, read with the Companies (Accounts) Rules, 2014 (as amended). This responsibility also includes maintenance of adequate accounting records in accordance with the provisions of the Act for safeguarding the assets of the Company and for preventing and detecting frauds and other irregularities; selection and application of appropriate accounting policies; making judgements and estimates that are reasonable and prudent; and the design, implementation and maintenance of adequate internal financial controls, that were operating effectively for ensuring the accuracy and completeness of the accounting records, relevant to the preparation and presentation of the financial statements, that give a true and fair view and are free from material mis-statement(s), whether due to fraud or error.\n\nIn preparing the said financial statements, the Management is responsible for assessing the Company’s ability to continue as a Going Concern, disclosing, as applicable, matters related to a Going Concern and using the Going Concern basis of accounting unless the Management either intends to liquidate the Company or to cease operations, or has no realistic alternative but to do so.\n\nThe Board of Directors are also responsible for overseeing the Company’s financial reporting process.\n\n5. Auditor’s responsibilities for the audit of the financial statements\nOur objectives are to obtain reasonable assurance about whether the said financial statements as a whole are free from material mis-statements, whether due to fraud or error and to issue an Auditor’s report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with Standards on Auditing (SAs) will always detect a material mis-statement when it exists. Mis-statements can arise from fraud or error and are considered material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of these financial statements.\n\nAs part of an audit in accordance with Standards on Auditing (SAs), we exercise professional judgment and maintain professional skepticism throughout the audit.\n\nWe also:\n\n•  Identify and assess the risks of material mis-statement of the financial statements, whether due to fraud or error, design and perform audit procedures responsive to those risks and obtain audit evidence that is sufficient and appropriate to provide a basis for our opinion. The risk of not detecting a material mis-statement resulting from fraud is higher than for one resulting from error, as fraud may involve collusion, forgery, intentional omissions, misrepresentations or the override of internal control(s).\n\n•  Obtain an understanding of internal controls relevant to the audit in order to design audit procedures that are appropriate in the circumstances. Under Section 143(3)(i) of the Act, we are also responsible for expressing our opinion on whether the Company has adequate internal financial controls system in place and the operating effectiveness of such controls.\n\n•  Evaluate the appropriateness of accounting policies used and the reasonableness of accounting estimates and related disclosures made by the management.\n\n•  Conclude on the appropriateness of the Management’s use of the Going Concern basis of accounting and based on the audit evidence obtained, whether a material uncertainty exists related to events or conditions that may cast significant doubt on the Company’s ability to continue as a Going Concern. If we conclude that a material uncertainty exists, we are required to draw attention in our Auditor’s report to the related disclosures in the financial statements or, if such disclosures are inadequate, to modify our opinion. Our conclusions are based on the audit evidence obtained upto the date of our Auditor’s report. However, future events or conditions may cause the Company to cease to continue as a Going Concern though none exist presently.\n\n•  Evaluate the overall presentation, structure and content of the financial statements, including the disclosures and whether the financial statements represent the underlying transactions and events in a manner that achieves fair presentation.\n\nWe communicate with those charged with governance of the Company regarding, among other matters, the planned scope and timing of the audit and significant audit findings, including any significant deficiencies in internal control(s) that we identify during our audit.\n\nWe also provide those charged with governance with a statement that we have complied with relevant ethical requirements regarding independence and to communicate with them all relationships and other matters that may reasonably be thought to bear on our independence and where applicable, related safeguards.\n\nWe believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion on the financial statements.\n\n6. Report on Other Legal and Regulatory Requirements\nWe report on the other applicable legal and regulatory requirements as under: -\n\nA) "),
  f("caroApplicability"),
  t("\n\nB)As required by Section 143(3) of the Act, based on our audit, we report that:\n\ni)We have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purposes of our audit;\n\nii)In our opinion, proper books of account as required by law have been kept by the Company in so far as appears from our examination of those books;\n\niii) "),
  f("cfsClauseIII"),
  t(" dealt with by this Report are in agreement with the books of account maintained for the purpose of preparation of these financial statements;\n\niv)In our opinion, the aforesaid financial statements comply with the Companies (Accounting Standards) Rules, 2006 (as amended) specified under Section 133 of the Act read with the Companies (Accounts) Rules, 2014 (as amended);\n\nv)On the basis of written representations received from the Directors as on 31st March, "),
  f("fyEndYear"),
  t(" and taken on record by the Board of Directors, none of the Directors are disqualified as on 31st March, "),
  f("fyEndYear"),
  t(" from being appointed as a Director of the Company in terms of Section 164 (2) of the Act;\n\nvi) "),
  f("ifcClause"),
  t("\n\nvii) The Company being a private limited Company, the provisions of Section 197 read with Schedule V of the Act relating to reporting on managerial remuneration and compliance with such provisions, are not applicable to the Company;\n\nviii) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014 (as amended), in our opinion and to the best of our information and according to the explanations given to us :-\n\nThe Company does not have any pending litigation before any Court of law or appellate authority which would impact its financial position;\n\nThe Company does not have any long-term contracts including derivative contracts from which there could arise any material foreseeable losses during the year ended 31st March, "),
  f("fyEndYear"),
  t(" for which provisions are required to be made;\n\nThere are no amounts that are required to be transferred to the Investor Education and Protection Fund by the Company during the year ended 31st March, "),
  f("fyEndYear"),
  t(";\n\n(1) Pursuant to Rule 11(e) (i) of the Companies (Audit and Auditors) Amendment Rules, 2021, the Management has represented to us that, to the best of their knowledge and belief, no funds have been advanced or loaned or invested (either from borrowed funds or share premium or any other sources or kind of funds) by the Company to or in any other person(s) or entity(ies), including foreign entities (“Intermediaries”), with the understanding, whether recorded in writing or otherwise, that the  Intermediary shall, directly or indirectly lend or invest in other persons or entities identified in any manner whatsoever by or on behalf of the Company (“Ultimate Beneficiaries”) or provide any guarantee, security or the like on behalf of the Ultimate Beneficiaries.\n\n(2) Pursuant to Rule 11(e) (ii) of the Companies (Audit and Auditors) Amendment Rules, 2021, the Management has further represented to us that, to the best of their knowledge and belief, no funds have been received by the Company from any person or entity, including foreign entities (Funding Parties), with the understanding, whether recorded in writing or otherwise, that the Company shall, whether, directly or indirectly, lend or invest in other persons or entities identified in any manner whatsoever by or on behalf of the Funding Party (“Ultimate Beneficiaries”) or provide any guarantee, security or the like on behalf of the Ultimate Beneficiaries; and\n\n(3) Pursuant to Rule 11(e) (iii) of the Companies (Audit and Auditors) Amendment Rules, 2021, we further report here that based on such audit procedures as we have considered reasonable and appropriate in the circumstances, nothing has come to our notice that has caused us to believe that the representations made by the Management as in sub-paras d) (1) and (2) above contain any material mis-statements.\n\nWe report that the Company has neither declared nor paid any dividend during the year under report in contravention of the provisions of Section 123 of the Companies Act, 2013; and\n\nBased on our examination which included test checks, the Company has used an accounting software program for maintaining its books of account "),
  f("auditTrail"),
  t("\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm Regn. No. "),
  f("firmRegistrationNumber"),
  t(")\n\n"),
  f("partnerName"),
  t("\nPartner\n(ICAI M.No. "),
  f("membershipNo"),
  t(")\n\nPlace : "),
  f("placeOfSignature"),
  t("\nDated : "),
  f("reportDate"),
  t("\nICAI UDIN : "),
  f("udin"),
  t("\n\n"),
  f("annexureA"),
  f("annexureB"),
];

const annexureASegments: Segment[] = [
  t("“Annexure A” referred to in Paragraph clause A) of paragraph 6 of the Independent Auditor’s Report of even date to the members of "),
  f("entityName"),
  t(" on the financial statements for the year ended 31st March, "),
  f("fyEndYear"),
  t("\n\nIn terms of the information and explanations sought by us and given by the Company and the books of account and records examined by us in the normal course of audit, and to the best of our knowledge and belief, we report that:\n\n(i) (a) (A) The Company has maintained proper records showing full particulars, including quantitative details, situation of property, plant and equipment.\n\n(B) "),
  f("caroIntangibles"),
  t("\n\n(b) The property, plant and equipment have been physically verified by the management during the year and no material discrepancies were noticed on such verification. In our opinion, the frequency of physical verification programme adopted by the Company, is reasonable having regard to the size of the Company and the nature of its assets.\n\n(c) The title deeds of all the immovable properties held by the Company, disclosed in the financial statements, are held in the name of the Company.\n\n(d) The Company has not revalued any of its property, plant and equipment and intangible assets during the year.\n\n(e) No proceedings have been initiated or are pending against the Company for holding any benami property under the Prohibition of Benami Property Transactions Act, 1988 (as amended) and rules made thereunder.\n\n(ii) (a) "),
  f("caroInventory"),
  t("\n\n(b) The company has been sanctioned working capital limits in excess of five crore rupees (at any point of time during the year), in aggregate, from banks or financial institutions on the basis of security of current assets; quarterly returns or statements filed by the company with such banks or financial institutions are in agreement with the books of account of the Company.\n\n(iii) "),
  f("caroLoans"),
  t("\n\n(iv) According to the information and explanation given to us, during the year the company has no loans, investments, guarantees or security where provisions of section 185 and 186 of the Companies Act, 2013 are to be complied with.\n\n(v) The Company has not accepted any deposits or amounts which are deemed to be deposits under the directives of the Reserve Bank of India and the provisions of Sections 73 to 76 or any other relevant provisions of the Companies Act, 2013 and the rules framed thereunder, where applicable. Accordingly, the provisions of clause 3(v) of the Order are not applicable.\n\n(vi) To the best of our knowledge and belief, the Central Government has not specified maintenance of cost records under sub-section (1) of Section 148 of the Act, in respect of Company’s products/ services. Accordingly, the provisions of clause 3(vi) of the Order are not applicable.\n\n(vii) (a) "),
  f("caroStatutoryDues"),
  t("\n\n(b) There are no dues in respect of Goods and Services Tax, provident fund, employees’ state insurance, income-tax, sales-tax, service tax, duty of customs, duty of excise, value added tax, cess and any other statutory dues that have not been deposited with the appropriate authorities on account of any dispute.\n\n(viii) According to the information and explanation given to us, company has no transactions, not recorded in the books of account have been surrendered or disclosed as income during the year in the tax assessments under the Income Tax Act, 1961;\n\n(ix) (a) "),
  f("caroDefaults"),
  t("\n\n(b) Company is not declared wilful defaulter by any bank or financial institution or other lender;\n\n(c) According to the information and explanation given to us, term loans were applied for the purpose for which the loans were obtained;\n\n(d) According to the information and explanation given to us, funds raised on short term basis have not been utilised for long term purposes;\n\n(e) According to the information and explanation given to us, the company has not taken any funds from any entity or person on account of or to meet the obligations of its subsidiaries, associates or joint ventures;\n\n(f) According to the information and explanation given to us, the company has not raised loans during the year on the pledge of securities held in its subsidiaries, joint ventures or associate companies;\n\n(x) (a) The Company has not raised moneys by way of initial public offer or further public offer (including debt instruments) during the year;\n\n(b) According to the information and explanation given to us, the Company has not made any preferential allotment or private placement of shares or convertible debentures (fully, partially or optionally convertible) during the year.\n\n(xi) (a) "),
  f("caroFraud"),
  t("\n\n(b) According to the information and explanation given to us, no report under sub-section (12) of section 143 of the Companies Act has been filed by the auditors in Form ADT-4 as prescribed under rule 13 of Companies (Audit and Auditors) Rules, 2014 with the Central Government;\n\n(c) According to the information and explanation given to us, no whistle-blower complaints, received during the year by the company;\n\n(xii) Company is not a Nidhi company, accordingly provisions of the Clause 3(xii) of the Order is not applicable to the company:\n\n(xiii) According to the information and explanations given to us, we are of the opinion that all transactions with related parties are in compliance with Section 188 of Companies Act, 2013 where applicable and the details have been disclosed in the Financial Statements etc., as required by the Accounting Standards and the Companies Act, 2013. Further, according to the information and explanations given to us, the Company is not required to constitute an audit committee under section 177 of the Act.\n\n(xiv) According to the information and explanations given to us, the Company does not have an internal audit system as per the provisions of section 138 of the Act.\n\n(xv) According to the information and explanations given to us, we are of the opinion that the company has not entered into any non-cash transactions with directors or persons connected with him and accordingly, the provisions of clause 3(xv) of the Order is not applicable.\n\n(xvi) According to the information and explanations given to us, we are of the opinion that the company is not required to be registered under section 45-IA of the Reserve Bank of India Act, 1934 and the company is not a Core Investment Company (CIC) as defined in the regulations made by the Reserve Bank of India, accordingly the provisions of clause 3(xvi) of the Order are not applicable;\n\n(xvii) According to the information and explanations given to us and based on the audit procedures conducted we are of opinion that the company has not incurred any cash losses in the financial year and the immediately preceding financial year\n\n(xviii) There has been no resignation of the statutory auditors during the year and accordingly, the provisions of clause 3(xviii) of the Order is not applicable;\n\n(xix) On the basis of the financial ratios, ageing and expected dates of realization of financial assets and payment of financial liabilities, other information accompanying the financial statements, our knowledge of the Board of Directors and management plans and based on our examination of the evidence supporting the assumptions, nothing has come to our attention, which causes us to believe that any material uncertainty exists as on the date of the audit report indicating that company is incapable of meeting its liabilities existing at the date of balance sheet as and when they fall due within a period of one year from the balance sheet date. We, however, state that this is not an assurance as to the future viability of the company. We further state that our reporting is based on the facts up to the date of the audit report and we neither give any guarantee nor any assurance that all liabilities falling due within a period of one year from the balance sheet date, will get discharged by the company as and when they fall due.\n\n(xx) "),
  f("caroCSR"),
  t("\n\n(xxi) The reporting under clause 3(xxi) of the Order is not applicable in respect of audit of financial statements of the Company. Accordingly, no comment has been included in respect of said clause under this report.\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm Regn. No. "),
  f("firmRegistrationNumber"),
  t(")\n\n"),
  f("partnerName"),
  t("\nPartner\n(ICAI M.No. "),
  f("membershipNo"),
  t(")\n\nPlace : "),
  f("placeOfSignature"),
  t("\nDated : "),
  f("reportDate"),
  t("\nICAI UDIN : "),
  f("udin"),
];

const annexureBSegments: Segment[] = [
  t("“Annexure B” referred to in Paragraph clause B) of paragraph 6 of the Independent Auditor’s Report of even date to the members of "),
  f("entityName"),
  t(" on the financial statements for the year ended 31st March, "),
  f("fyEndYear"),
  t("\n\nReport on the Internal Financial Controls under Clause (i) of Sub-section 3 of Section 143 of the Companies Act, 2013 (“the Act”)\n\nWe have audited the internal financial controls over financial reporting of "),
  f("entityName"),
  t(" (“the Company”) as of 31st March, "),
  f("fyEndYear"),
  t(" in conjunction with our audit of the financial statements of the Company for the year ended on that date.\n\nManagement’s Responsibility for Internal Financial Controls\nThe Company’s management is responsible for establishing and maintaining internal financial controls based on the internal control over financial reporting criteria established by the Company considering the essential components of internal control stated in the Guidance Note on Audit of Internal Financial Controls over Financial Reporting issued by the Institute of Chartered Accountants of India (‘ICAI’). These responsibilities include the design, implementation and maintenance of adequate internal financial controls that were operating effectively for ensuring the orderly and efficient conduct of its business, including adherence to company’s policies, the safeguarding of its assets, the prevention and detection of frauds and errors, the accuracy and completeness of the accounting records, and the timely preparation of reliable financial information, as required under the Companies Act, 2013.\n\nAuditors’ Responsibility\nOur responsibility is to express an opinion on the Company’s internal financial controls over financial reporting based on our audit. We conducted our audit in accordance with the Guidance Note on Audit of Internal Financial Controls Over Financial Reporting (the “Guidance Note”) and the Standards on Auditing, issued by ICAI and deemed to be prescribed under section 143(10) of the Companies Act, 2013, to the extent applicable to an audit of internal financial controls, both applicable to an audit of Internal Financial Controls and, both issued by the Institute of Chartered Accountants of India. Those Standards and the Guidance Note require that we comply with ethical requirements and plan and perform the audit to obtain reasonable assurance about whether adequate internal financial controls over financial reporting was established and maintained and if such controls operated effectively in all material respects.\n\nOur audit involves performing procedures to obtain audit evidence about the adequacy of the internal financial controls system over financial reporting and their operating effectiveness. Our audit of internal financial controls over financial reporting included obtaining an understanding of internal financial controls over financial reporting, assessing the risk that a material weakness exists, and testing and evaluating the design and operating effectiveness of internal control based on the assessed risk. The procedures selected depend on the auditor’s judgment, including the assessment of the risks of material misstatement of the financial statements, whether due to fraud or error.\n\nWe believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion on the Company’s internal financial controls system over financial reporting.\n\nMeaning of Internal Financial Controls over Financial Reporting\nA company’s internal financial control over financial reporting is a process designed to provide reasonable assurance regarding the reliability of financial reporting and the preparation of financial statements for external purposes in accordance with generally accepted accounting principles. A company’s internal financial control over financial reporting includes those policies and procedures that;\n\n(1) pertain to the maintenance of records that, in reasonable detail, accurately and fairly reflect the transactions and dispositions of the assets of the company;\n\n(2) provide reasonable assurance that transactions are recorded as necessary to permit preparation of financial statements in accordance with generally accepted accounting principles, and that receipts and expenditures of the company are being made only in accordance with authorizations of management and directors of the company; and\n\n(3) provide reasonable assurance regarding prevention or timely detection of unauthorized acquisition, use, or disposition of the company’s assets that could have a material effect on the financial statements.\n\nInherent Limitations of Internal Financial Controls Over Financial Reporting\nBecause of the inherent limitations of internal financial controls over financial reporting, including the possibility of collusion or improper management override of controls, material misstatements due to error or fraud may occur and not be detected. Also, projections of any evaluation of the internal financial controls over financial reporting to future periods are subject to the risk that the internal financial control over financial reporting may become inadequate because of changes in conditions, or that the degree of compliance with the policies or procedures may deteriorate.\n\nOpinion\nIn our opinion, the Company has, in all material respects, an adequate internal financial controls system over financial reporting and such internal financial controls over financial reporting were operating effectively as at 31st March, "),
  f("fyEndYear"),
  t(", based on the internal control over financial reporting criteria established by the Company considering the essential components of internal control stated in the Guidance Note on Audit of Internal Financial Controls Over Financial Reporting issued by the Institute of Chartered Accountants of India.\n\nFor "),
  f("firmName"),
  t("\nChartered Accountants\n(Firm Regn. No. "),
  f("firmRegistrationNumber"),
  t(")\n\n"),
  f("partnerName"),
  t("\nPartner\n(ICAI M.No. "),
  f("membershipNo"),
  t(")\n\nPlace : "),
  f("placeOfSignature"),
  t("\nDated : "),
  f("reportDate"),
  t("\nICAI UDIN : "),
  f("udin"),
];

const fields: FieldDef[] = [
  { key: "entityName", label: "Company name", type: "text", required: true, help: "As it should read in the report, e.g. “XYZ Private Limited”" },
  { key: "fyEndYear", label: "Financial year ended 31st March,", type: "year", required: true },

  // Cash Flow Statement — one user switch drives every span that mentions it.
  { key: "hasCFS", label: "Do the financial statements include a Cash Flow Statement?", type: "boolToggle", required: true, onText: "", offText: "" },
  { key: "cfsOpinionScope", label: "(derived)", type: "boolToggle", deriveFrom: "hasCFS",
    onText: ", the Statement of Profit and Loss and the Cash Flow Statement",
    offText: " and the Statement of Profit and Loss" },
  { key: "cfsOpinionResult", label: "(derived)", type: "boolToggle", deriveFrom: "hasCFS",
    onText: ", of its profit and its cash flows",
    offText: " and its profit" },
  { key: "cfsMgmtResponsibility", label: "(derived)", type: "boolToggle", deriveFrom: "hasCFS",
    onText: "financial position, financial performance and cash flows",
    offText: "financial position and financial performance" },
  { key: "cfsClauseIII", label: "(derived)", type: "boolToggle", deriveFrom: "hasCFS",
    onText: "The Balance Sheet, the Statement of Profit and Loss and the Cash Flow Statement",
    offText: "The Balance Sheet and the Statement of Profit and Loss" },

  // CARO 2020 — swaps paragraph 6 A) and switches Annexure A on.
  { key: "caroApplicable", label: "Does CARO 2020 apply to the Company?", type: "boolToggle", required: true, help: "On: paragraph 6 A) refers to Annexure A and the annexure is generated.", onText: "", offText: "" },
  { key: "caroApplicability", label: "(derived)", type: "boolToggle", deriveFrom: "caroApplicable",
    onText: "As required by the Companies (Auditor's Report) Order, 2020 (“the Order”) issued by the Central Government of India in terms of sub-section (11) of Section 143 of the Companies Act, 2013, we give in the “Annexure A” a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable.",
    offText: "As required by the Companies (Auditor's Report) Order, 2020 (“the Order”) issued by the Central Government of India in terms of sub-section (11) of Section 143 of the Act, in our opinion and according to the information and explanation given to us the said order is not applicable to the Company." },

  // Internal financial controls under s.143(3)(i) — swaps clause vi) and adds Annexure B.
  { key: "ifcReporting", label: "Does the report include the internal financial controls report (s.143(3)(i))?", type: "boolToggle", required: true, help: "On: clause vi) refers to Annexure B and the annexure is generated.", onText: "", offText: "" },
  { key: "ifcClause", label: "(derived)", type: "boolToggle", deriveFrom: "ifcReporting",
    onText: "This report contain a report on internal financial controls under Section 143(3)(i) of the Act with respect to the adequacy of internal financial controls over the financial reporting of the Company and the operating effectiveness of such controls, as in view of the Notification bearing No. G.S.R. 583 (E) dated 13th June 2017 issued by the Ministry of Corporate Affairs, Government of India read with the General Circular No.08/2017 dated 25th July, 2017 issued by the said Ministry, we give in the “Annexure B” a statement on the matters specified.",
    offText: "This report does not contain a report on internal financial controls under Section 143(3)(i) of the Act with respect to the adequacy of internal financial controls over the financial reporting of the Company and the operating effectiveness of such controls, as in view of the Notification bearing No. G.S.R. 583 (E) dated 13th June 2017 issued by the Ministry of Corporate Affairs, Government of India read with the General Circular No.08/2017 dated 25th July, 2017 issued by the said Ministry, such reporting is not required for the Company;" },

  // Rule 3(1) audit-trail sentence. Both source files state that no audit trail exists;
  // they merely word it differently. See notes — a "trail maintained" clause is missing.
  { key: "auditTrail", label: "Audit trail (Rule 3(1)) wording", type: "enumToggle", required: true, options: [
    { value: "absent", label: "No audit trail — 2025 wording (edit log)", fragment: "but however the said software program does not have the feature of recording audit trail (edit log) facility presently in terms of the stipulations laid down by the proviso to Rule 3(1) of the Companies (Accounts) Rules, 2014." },
    { value: "absentAlt", label: "No audit trail — earlier wording", fragment: "and the said software program doesn't have the feature of recording audit trail facility present in terms of the stipulations laid down by the proviso to Rule 3(1) of the Companies (Accounts) Rules, 2014." },
  ] },

  // Signature block.
  { key: "firmName", label: "Firm name", type: "text", required: true },
  { key: "firmRegistrationNumber", label: "Firm Registration Number (FRN)", type: "text", required: true },
  { key: "partnerName", label: "Signing partner", type: "text", required: true },
  { key: "membershipNo", label: "ICAI Membership No.", type: "text", required: true },
  { key: "placeOfSignature", label: "Place", type: "text", required: true },
  { key: "reportDate", label: "Date of report", type: "date", required: true },
  { key: "udin", label: "UDIN (paste from the ICAI portal — never generated)", type: "udin", required: true, validate: "udin", help: "18 chars, ^[0-9A-Z]{18}$" },

  // Annexure A — CARO 2020. Its own sub-fields are the clauses that vary per client; the
  // remaining clauses are the firm's fixed wording.
  { key: "annexureA", label: "Annexure A — CARO 2020", type: "optionalBlock",
    enabledWhen: { field: "caroApplicable", equals: true },
    subSegments: annexureASegments,
    subFields: [
      { key: "caroIntangibles", label: "Does the Company hold intangible assets?", type: "boolToggle", required: true,
        onText: "The Company has maintained proper records showing full particulars of intangible assets.",
        offText: "The Company does not have any intangible assets and accordingly, reporting under clause 3(i)(a)(B) of the Order is not applicable to the Company." },
      { key: "caroInventory", label: "Does the Company hold inventory?", type: "boolToggle", required: true,
        onText: "The management has conducted physical verification of inventory at reasonable intervals during the year. In our opinion, the coverage and procedure of such verification by the management is appropriate and no discrepancies of 10% or more in the aggregate for each class of inventory were noticed as compared to book records.",
        offText: "The Company does not have any inventory and accordingly, reporting under clause 3(ii)(a) of the Order is not applicable to the Company." },
      { key: "caroLoans", label: "Did the Company grant loans, guarantees or security during the year?", type: "boolToggle", required: true,
        onText: "The Company has during the year made investments in, provided guarantee or security, or granted loans or advances in the nature of loans, secured or unsecured, to companies, firms, Limited Liability Partnerships or other parties, in respect of which the requisite details have been disclosed in the financial statements.",
        offText: "The Company has during the year, not made investments in, provided any guarantee or security or granted any loans or advances in the nature of loans, secured or unsecured, to companies, firms, Limited Liability Partnerships or any other parties. Accordingly, the provisions of clauses 3(iii) of the Order are not applicable." },
      { key: "caroStatutoryDues", label: "Is the Company regular in depositing undisputed statutory dues?", type: "boolToggle", required: true,
        onText: "The Company is regular in depositing undisputed statutory dues including Goods and Services Tax, provident fund, employees’ state insurance, income-tax, sales-tax, service tax, duty of customs, duty of excise, value added tax, cess and any other statutory dues, as applicable, with the appropriate authorities. Further, no undisputed amounts payable in respect thereof were outstanding at the year-end for a period of more than six months from the date they became payable.",
        offText: "The Company is not regular in depositing undisputed statutory dues including Goods and Services Tax, provident fund, employees’ state insurance, income-tax, sales-tax, service tax, duty of customs, duty of excise, value added tax, cess and any other statutory dues, as applicable, with the appropriate authorities, and undisputed amounts payable in respect thereof were outstanding at the year-end for a period of more than six months from the date they became payable." },
      { key: "caroDefaults", label: "Did the Company default in repayment of loans or interest during the year?", type: "boolToggle", required: true,
        onText: "In our opinion, the company has defaulted in repayment of loans or other borrowings or in the payment of interest thereon to a lender during the year;",
        offText: "In our opinion, the company has not defaulted in repayment of loans or other borrowings or in the payment of interest thereon to any lender during the year;" },
      { key: "caroFraud", label: "Was any fraud by or on the Company noticed or reported during the year?", type: "boolToggle", required: true,
        onText: "According to the information and explanation given to us, fraud by the company or on the company has been noticed or reported during the year covered by our audit, the nature and amount whereof has been disclosed in the financial statements;",
        offText: "According to the information and explanation given to us, any fraud by the company or any fraud on the company has not been noticed or reported during the year or reported during the period covered by our audit;" },
      { key: "caroCSR", label: "Do the Section 135 CSR provisions apply to the Company?", type: "boolToggle", required: true,
        onText: "The provisions of Section 135 towards corporate social responsibility are applicable to the company and the company has complied with the said provisions in respect of the amount required to be spent during the year.",
        offText: "The provisions of Section 135 towards corporate social responsibility are not applicable on the company. Accordingly, the provisions of clause 3(xx) of the Order is not applicable." },
    ] },

  // Annexure B — internal financial controls. No sub-fields: it reuses the entity and
  // signature fields above.
  { key: "annexureB", label: "Annexure B — Internal financial controls", type: "optionalBlock",
    enabledWhen: { field: "ifcReporting", equals: true },
    subSegments: annexureBSegments,
    subFields: [] },
];

export const auditReport: CertificateTemplate = {
  id: "audit-report",
  romanNo: "ar",
  title: "Independent Auditors’ Report",
  version: "2025.10.0",
  status: "draft", // see notes — a partner must review the authored CARO wording first
  sourcePdf: "",   // firm template, not an ICAI illustrative format
  sourcePages: [0, 0],
  hash: "a16eabc41dad3e5ecbc317f0a1865862751eb581b1451a960a02eaa708bc62c4", // pinned; re-pin only on a reviewed wording change
  fields,
  segments: bodySegments,
  pageBreakBefore: ["“Annexure A”", "“Annexure B”"],
  headings: ["Report on the audit of the financial statements", "1. Opinion", "2. Basis for our opinion", "3. Information other than the financial statements and relevance of auditors’ report thereon", "4. Management’s Responsibility for the financial statements", "5. Auditor’s responsibilities for the audit of the financial statements", "6. Report on Other Legal and Regulatory Requirements", "Report on the Internal Financial Controls under Clause (i) of Sub-section 3 of Section 143 of the Companies Act, 2013 (“the Act”)", "Management’s Responsibility for Internal Financial Controls", "Auditors’ Responsibility", "Meaning of Internal Financial Controls over Financial Reporting", "Inherent Limitations of Internal Financial Controls Over Financial Reporting"],
  boldFields: ["entityName"],
  notes: [
    "Ported from the firm's three Word templates (AUDIT REPORT WITHOUT CFS / WITH CFS / WITH CFS and CARO, 2025). Locked text is lifted verbatim from those files, not retyped.",
    "The three source files are ONE report with toggles, not three documents: hasCFS swaps four spans (opinion scope, opinion result, management's responsibility, clause iii), caroApplicable swaps para 6 A) and adds Annexure A, ifcReporting swaps clause vi) and adds Annexure B.",
    "The source's manual page markers (-1-, -2-, …) and the repeated '(Contd…)' section headings are page-break artifacts of the Word file and are intentionally dropped — Word repaginates the generated document.",
    "Dates are normalised to '31st March, <year>'; the sources mix '31st March, 2025', '31st March 2025' and '31 March 2025'.",
    "Source typo 'to the extent application' corrected to 'to the extent applicable' in the CARO-applicable wording.",
    "Signature block set in title case (Chartered Accountants / Partner / Place / Dated), matching the WITHOUT CFS source. The other two sources use all-caps.",
    "AUTHORED LEGAL TEXT — REVIEW BEFORE SIGN-OFF: the firm's samples give only ONE answer per CARO clause. The opposite wording for these toggles was drafted here from standard CARO 2020 language and has NOT been taken from the firm's files: caroIntangibles (onText), caroInventory (offText), caroLoans (onText), caroStatutoryDues (offText), caroDefaults (onText), caroFraud (onText), caroCSR (offText).",
    "auditTrail offers only the two phrasings that appear in the sources; both state that no audit trail exists. A clause for a company that DOES maintain an audit trail must be supplied by the firm before this template covers that case.",
    "Kept as status 'draft' (hidden in production) until a partner reviews the authored clauses above and sets verifiedBy/verifiedAt."
],
};

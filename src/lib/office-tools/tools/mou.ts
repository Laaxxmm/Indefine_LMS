import { z } from "zod";
import { Paragraph, TextRun, AlignmentType } from "docx";
import { buildDoc, clause, heading, para, spacer, boxTable, b, t } from "../docx";
import { longEffectiveDate } from "../date";

// Memorandum of Understanding — faithful port of tools/mou.py.

export const mouZ = z.object({
  agreementDate: z.string().min(1), // ISO
  party1Name: z.string().min(1),
  party1Address: z.string().min(1),
  party1Short: z.string().min(1),
  party2Name: z.string().min(1),
  party2Address: z.string().min(1),
  party2Short: z.string().min(1),
  projectTitle: z.string().min(1),
  objectives: z.string().min(1),
  businessType: z.string().min(1),
  scopeParty1: z.string().min(1),
  scopeParty2: z.string().min(1),
  rolesParty1: z.string().min(1),
  rolesParty2: z.string().min(1),
  governanceCompany: z.string().min(1),
  ipOwner: z.string().min(1),
  commercializationParty: z.string().min(1),
  validityYears: z.number().int().positive(),
  courtLocation: z.string().min(1),
  sig1Name: z.string().min(1),
  sig1Designation: z.string().min(1),
  sig1AuthDoc: z.string().min(1),
  sig1AuthDate: z.string().min(1),
  sig2Name: z.string().min(1),
  sig2Designation: z.string().min(1),
  sig2AuthDoc: z.string().min(1),
  sig2AuthDate: z.string().min(1),
  witness1Name: z.string().min(1),
  witness1Address: z.string().min(1),
  witness2Name: z.string().min(1),
  witness2Address: z.string().min(1),
});
export type MouInput = z.infer<typeof mouZ>;

const bullets = (multiline: string) => multiline.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(s)] }));
const centered = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun(text)] });

export async function renderMouDocx(m: MouInput): Promise<Buffer> {
  const effectiveDate = longEffectiveDate(m.agreementDate);
  const c: Paragraph[] = [];

  // E-stamp space + page break
  c.push(new Paragraph({ spacing: { after: 2880 }, children: [new TextRun({ text: "Space for E-Stamp", italics: true })] }));
  c.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }));

  c.push(heading("Memorandum of Understanding (MOU)"));
  c.push(spacer());
  c.push(para(`This MOU is made on this ${effectiveDate} (Effective Date)`));
  c.push(spacer());
  c.push(centered("BY and BETWEEN"));
  c.push(spacer());

  // Party 1
  c.push(para(b(m.party1Name), t(` a company having its registered office at ${m.party1Address}`)));
  c.push(para(t("hereinafter referred to as “"), b(m.party1Short), t("” (which expression shall wherever the context so admits include its successors in interest, liquidators, administrators and permitted assignees) of the "), b("First Part")));
  c.push(spacer());
  c.push(centered("AND"));
  c.push(spacer());

  // Party 2
  c.push(para(b(m.party2Name), t(` a company having its registered office at ${m.party2Address}`)));
  c.push(para(t("hereinafter referred to as “"), b(m.party2Short), t("” (which expression shall wherever the context so admits include its successors in interest, liquidators, administrators and permitted assignees) of the "), b("Second Part"), t(".")));
  c.push(spacer());

  c.push(para("WHEREAS all the parts are hereinafter referred to as “Parties”;"));
  c.push(para(b(`AND WHEREAS the Parties have conceived a Project entitled “${m.projectTitle}”`)));
  c.push(para(`AND WHEREAS, the Parties to this MOU desire to establish common framework to facilitate in terms of exchange of information, material, resources, responsibilities to carry out ${m.businessType} and to execute such other agreements as may be necessary for the Project.`));
  c.push(spacer());

  // 1. OBJECTIVE
  c.push(clause("1. OBJECTIVE:"));
  c.push(para("The Objective of the Project is as follows:-"));
  c.push(...bullets(m.objectives));
  c.push(spacer());

  // 2. Definitions
  c.push(clause("2. Definitions"));
  c.push(para("a) Project IP shall mean all inventions, innovations, processes, technologies and end products that are outcomes of the Project."));
  c.push(para("b) Publication shall mean any disclosure of the results to any third party on a non-confidential basis, including, but not limited to meeting abstracts, seminar notifications, announcements, conference proceedings, trade press articles and manuscripts for submission to refereed journals."));
  c.push(spacer());

  // 3. SCOPE OF WORK
  c.push(clause("3. SCOPE OF WORK:"));
  c.push(para(t("The scope of work of "), b(m.party1Short), t(" shall, inter alia, include:")));
  c.push(...bullets(m.scopeParty1));
  c.push(para(t("The scope of work of "), b(m.party2Short), t(" shall, inter alia, include:")));
  c.push(...bullets(m.scopeParty2));
  c.push(spacer());

  // 4. Roles & Responsibilities
  c.push(clause("4. Roles & Responsibilities"));
  c.push(para(t("Roles & Responsibilities of "), b(m.party1Short), t(" shall, inter alia, include")));
  c.push(...bullets(m.rolesParty1));
  c.push(para(t("Roles & Responsibilities of "), b(m.party2Short), t(" shall, inter alia, include")));
  c.push(...bullets(m.rolesParty2));
  c.push(spacer());

  // 5. Right of use
  c.push(clause("5. Right of use"));
  c.push(para("a. The Background IP needed for the Project is available to be used freely by the parties for execution of the Project in terms of this MOU."));
  c.push(para("a. Each Party shall promptly make written disclosure to discuss and coordinate with one another the aspects of Project IP including the ownership, cost of protection/maintenance, publication needs, and commercial exploitation of Project results and can enter into separate agreement if required."));
  c.push(spacer());

  // 6. Confidentiality
  c.push(clause("6. Confidentiality"));
  c.push(para("During the tenure of the Project, all the Parties agree to maintain strict confidentiality and refrain from disclosure of all or any part of the information and data exchanged/generated from the Project for any purpose other than in accordance with this MOU. It shall be the responsibility of all the Parties to ensure maintenance of such confidentiality in respect of their behalf and on behalf of their employees, representatives and associates involved in the Project."));
  c.push(para("The Parties shall not have any obligation of confidentiality with respect to any information that: is in the public domain by use and/or publication at the time of its disclosure by the disclosing party; or was already in possession of the recipient prior to receipt from the disclosing party; or is properly obtained by the recipient from a third party with a valid right to disclose such information and such third party is not under confidentiality obligation to the disclosing party; or was disclosed to any third party on a non-confidential basis prior to commencement of the Project; or is required by public authority, by law or decree."));
  c.push(spacer());

  // 7. Project governance framework
  c.push(clause("7. Project governance framework"));
  c.push(para("i) The parties will jointly decide in connection to Project IP, Profit sharing etc. based on the following principles separately if the project implementation results in generation of any IP."));
  c.push(para(`ii) The ${m.governanceCompany} agrees to conduct and manage the implementation efforts and the resulting products, services, processes, technologies, materials, software, data or other innovations (collectively, “Project Development”) and any IP that arises (New IP) in the manner that ensures ‘Global Access’ requires that:`));
  c.push(para("a. The knowledge and information gained from the Project be promptly and broadly disseminated or published, and;"));
  c.push(para("b. Project developments and/or Project IP is made available and accessible at an affordable price to people most in need within developing countries."));
  c.push(spacer());

  // 8. Publications
  c.push(clause("8. Publications"));
  c.push(para("The parties can jointly publish the work results."));
  c.push(para("Provided, no party shall publish or present the results of this project to any third party without the prior review of the other parties. Each party shall be provided a copy of the paper or presentation for purpose of permitting the parties to identify within sixty (60) days : a) any confidential information: or b) any patentable subject matter. If either such matter is found in the proposed research paper, then the publishing party and the owner of the confidential information or patentable subject matter shall negotiate a mutually acceptable version prior to submission of the paper for publication. Upon request, parties owing the patentable subject matter shall receive up to an additional two (2) months in which to prepare and file any patent applications directed to patentable subject matter owned by the Parties."));
  c.push(spacer());

  // 9. INTELLECTUAL PROPERTY RIGHTS
  c.push(clause("9. INTELLECTUAL PROPERTY RIGHTS:"));
  c.push(para("a. “Intellectual Property” means the legal rights relating to inventions, patent applications, patents, copyrights, trademarks, mask works, trade secrets, and any other legally protectable information, including computer software, first made or generated by such investors ."));
  c.push(para(t("b. The “Intellectual Property Rights (IPR)” generated during the project will belong to "), b(m.ipOwner), t(" .")));
  c.push(para("c. Patent Prosecution and Expenses: The filing, prosecution, defense and maintenance of all Patents for the Inventions will be conducted and controlled by {ip_prosecutor}, acting reasonably and in good faith."));
  c.push(para("d. Background Intellectual Property: Any of the party possesses rights in background intellectual property, that is, intellectual property not otherwise subjected to this MoU, which would be useful or essential to the practice or commercialization of the results of this MoU, should be disclosed. Except to the limited extent required to perform a party’s obligations under this MoU, neither party receives any right, title, or interest in or to any Research Materials provided to it by the other party or any technology, works or inventions of the other party that are not Research Program Inventions, or any patent, copyright, trade secret or other proprietary rights in any of the foregoing."));
  c.push(para("e. Maintaining the Laboratory Notes: Each party agrees that research efforts will be well documented in the form a laboratory notes with accurate data disclosed for each experiments performed therein, during the course of this MoU."));
  c.push(para(t("f) The "), b(m.commercializationParty), t(" is having the commercialisation rights or selling rights.")));
  c.push(spacer());

  // 10. Validity and Termination
  c.push(clause("10. Validity and Termination"));
  c.push(para(t("i) The MOU shall be effective from the date of its signing by all the Parties. The MOU shall be valid for "), b(String(m.validityYears)), t(" years or till the completion of the project implementation by all the parties whichever is later.")));
  c.push(para("ii) The Parties may renew/terminate this MOU by mutual consent."));
  c.push(spacer());

  // 11. Alterations
  c.push(clause("11. Alterations"));
  c.push(para("Any alteration or amendment to this MOU shall be made in writing by all the Parties involved."));
  c.push(spacer());

  // 12. Severability
  c.push(clause("12. Severability"));
  c.push(para("In case any one or more of the provisions or parts of a provision contained in this MOU shall, for any reason, be held to be invalid, illegal or unenforceable in any respect, such invalidity, illegality or unenforceability shall not affect any other provision or part of a provision of this MOU; such term shall be excluded to the extent of such invalidity, illegality, or unenforceability; all other terms hereof shall remain in full force and effect"));
  c.push(spacer());

  // 13. Assignment of Rights and Duties
  c.push(clause("13. Assignment of Rights and Duties"));
  c.push(para("Rights and Duties in this MOU cannot be assigned to third party either in whole or in part without the prior written consent of the other Parties."));
  c.push(spacer());

  // 14. INDEMNIFICATION
  c.push(clause("14. INDEMNIFICATION:"));
  c.push(para("Neither party shall be held responsible for the indemnification of their respective obligations under this MoU due to the exigency of one or more of the force majeure events such as but not limited to acts of God, War, Flood, Earthquakes, Strikes, Lockouts beyond the control of the party claiming force majeure, Epidemics, Riots, Civil Commotions etc. provided on the occurrence and cessation of any such event the party affected thereby shall give a notice in writing to the other party within one month of such occurrence or cessation. If the force majeure conditions continue beyond six months, the parties shall jointly decide about the future course of action."));
  c.push(spacer());

  // 15. DISPUTE RESOLUTION
  c.push(clause("15. DISPUTE RESOLUTION, GOVERNING LAW AND JURISDICTION:"));
  c.push(para(
    t("Any disputes between the parties shall be resolved by mutual discussions. If such resolution is not possible, then the unresolved dispute or difference whatsoever arising between the "),
    b(m.party1Short), t(" and "), b(m.party2Short),
    t(` shall be referred for arbitration in accordance with the Arbitration Act, 1996. The MoU shall be considered, interpreted and governed by the laws of India and Courts at ${m.courtLocation} shall have exclusive jurisdiction in all such matters.`),
  ));
  c.push(spacer());

  // 16. Notices
  c.push(clause("16. Notices"));
  c.push(para("Notices shall be sent to the contact person at the address as set forth herein. The Parties shall duly notify each other in the event of any change."));
  c.push(spacer());

  c.push(para("IN WITNESS WHEREOF, the foregoing has been agreed to and accepted by the authorized representatives of each Party whose signatures appear below."));
  c.push(spacer());

  // Signature tables
  const sigTable = (roman: string, name: string, authDoc: string, authDate: string, sigName: string, designation: string, seal: string) =>
    boxTable([
      `${roman} For and on behalf of “${name}” duly authorized vide ${authDoc} dated ${authDate}`,
      "Signature",
      `Name: ${sigName}`,
      [new Paragraph({ children: [new TextRun(`Designation: ${designation}`)] }), new Paragraph({ children: [new TextRun(seal)] })],
    ]);

  return buildDoc([
    ...c,
    sigTable("I.", m.party1Name, m.sig1AuthDoc, m.sig1AuthDate, m.sig1Name, m.sig1Designation, "Official Seal"),
    spacer(),
    sigTable("(II)", m.party2Name, m.sig2AuthDoc, m.sig2AuthDate, m.sig2Name, m.sig2Designation, "official Seal"),
    spacer(),
    clause("Witnesses"),
    para(b("Witness 1:")),
    para("Signature:"),
    para(`Name: ${m.witness1Name}`),
    para(`Address: ${m.witness1Address}`),
    spacer(),
    para(b("Witness 2:")),
    para("Signature:"),
    para(`Name: ${m.witness2Name}`),
    para(`Address: ${m.witness2Address}`),
  ]);
}

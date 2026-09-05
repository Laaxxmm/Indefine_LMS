import { z } from "zod";
import { Paragraph, TextRun } from "docx";
import { buildDoc, clause, heading, para, bulletsFrom, b } from "../docx";
import { ordinal, MONTHS } from "../date";
import { numToWords } from "../numToWords";

// Deed of Declaration of Trust — faithful port of tools/trust.py (Calibri).
// Note: the source defines a Powers-of-the-Board list under clause 11 but a loop bug
// iterates an empty string, silently dropping it. We render the intended list — a trust
// deed reading "shall have the following powers:" with nothing after is clearly a defect.

const partyZ = z.object({
  name: z.string().min(1),
  aadhaar: z.string().min(1),
  pan: z.string().min(1),
  age: z.number().int().min(18),
  address: z.string().min(1),
  designation: z.string().min(1),
});

export const trustZ = z.object({
  dateExecution: z.string().min(1), // ISO
  shortObjects: z.string().min(1),
  detailedObjects: z.string().min(1),
  amountDeclared: z.number().positive(),
  trustName: z.string().min(1),
  trustAddress: z.string().min(1),
  parties: z.array(partyZ).min(2).max(15),
  boardTrustees: z.string().min(1),
  officers: z.string().min(1),
  signatures: z.string().min(1),
  witnesses: z.string().min(1),
});
export type TrustInput = z.infer<typeof trustZ>;

// Render a multi-line string as one paragraph with soft line breaks (preserves blanks).
function multiline(text: string, indent = 0): Paragraph {
  const lines = text.split("\n");
  return new Paragraph({
    indent: indent ? { left: indent } : undefined,
    spacing: { after: 120 },
    children: lines.map((ln, i) => new TextRun({ text: ln, break: i > 0 ? 1 : undefined })),
  });
}

const CESSATION = `i. Dies;
ii. Becomes of unsound mind;
iii. Is adjudged insolvent;
iv. Is convicted of an offence involving moral turpitude;
v. Tenders resignation in writing to the Managing Trustee or Secretary of the Trust and the same has been accepted by the Board of Trustees;
vi. Remains absent from the meetings of the Board of Trustees continuously for a period longer than six months without the leave of the Board;
vii. Is found carrying on activities which in the opinion of the Board of Trustees are determined or harmful to the interests of the Trust.`;

const POWERS_11 = `a. To stand possessed of the amount of corpus and other properties, both movable and immovable, as may be acquired from time to time by the Trust by purchase, exchange, grant, subscription, endowment, donation, contribution or in any manner whatsoever.
b. To apply and use the funds of the Trust for all or any of the objects of the Trust and to accumulate the surplus and unapplied portion of the said income and invest the same at the discretion of the Board of Trustees, subject however, to complying with the requirements of the Income-tax Act, 1961, as amended from time to time relating to accumulation of income and investment thereof.
c. To acquire on lease or by purchase or otherwise and to let out, grant license, sell, mortgage, hire, lease or transfer or in any other manner whatsoever, movable or immovable properties and on such terms and conditions as the Board of Trustees may think fit.
d. To receive and accept donations, grants, presents, awards, subsidies, moneys and other assets in any shape or form as gift or donation and to hold the same as part of the corpus of the Trust if so directed by a donor, or to make them available for the application to further the objects of the Trust treating the same as income of the Trust.
e. To accept, hold or administer any gift, donation or contribution in kind or money whether upon trust or not, and to make, undertake and execute any trust which may be deemed conducive to any objects of the Trust.
f. To compromise, compound, abandon, submit to arbitration or otherwise settle any actions, suits, proceedings, debts, claims, or things, whatsoever arising out of the administration of Trust fund or any institution maintained by this trust and for any of these purposes to enter into, give, execute and do such agreements, instruments or composition or arrangements, without being answerable for any loss occasioned thereby.
g. To receive, collect or realize or cause collection or realization of all income that accrue or become due on all or any investments.
h. To borrow money or receive money or deposit upon such terms, funds and assets of the Trust as the Board of Trustees shall deem necessary or expedient for the fulfillment of the fulfillment of the objects of the Trust.
i. To sell, mortgage, lease or otherwise transfer the properties belonging to the Trust, movable or immovable, for the benefit and purposes of the Trust. The Trustees shall exercise this power sparingly, and if it pertains immovable property, only by a vote of three-fourth majority of the Trustees.
j. To appoint, suspend, dismiss, reappoint or otherwise engage and manage employees, executives, officials and all other types of human resource on such terms including compensation as the Board may consider appropriate.
k. To open and maintain accounts of any nature in any bank(s) and to operate such accounts or authorize operations of such accounts by any member(s) of the Board of Trustees jointly or severally or by any other person.
l. To pay out of the Trust funds salaries, wages, rent, building maintenance, repairs and other expenses relating to the Trust, its institutions, its activities or its other affairs and for the management of the Trust.
m. To reimburse themselves or pay and discharge out of the funds or any Property of the Trust, all expenses that may be incurred in or about the execution of the Trust and power of these presents including travel expenditure incurred in the course of discharge of their duties.
n. To collaborate and enter into agreements with governments, Local bodies, organizations and institutions to promote or otherwise carry out the objects of the Trust.
o. To represent the Trust in all Courts (Original and Appellate) or before any authorities and departments of Government, Local and public authorities on various issues related to development, welfare and public interest on different issues concerning sanitation and the environment.
p. To execute or negotiate papers and documents (whether negotiable or non-negotiable), to receive monies or other assets and to grant receipts and discharges.
q. To sign and verify all pleadings, memorandum of appeal, petitions and applications of all kinds, to compromise, abandon or refer to arbitration the whole or any part of the claim by or against the Trust, to engage lawyers and to take all such other necessary steps.
r. To make and alter rules and regulations from time to time for the conduct of affairs of the Trust.
s. To appoint committees, sub committees, boards of management and like things from among members of the Board of Trustees and/or along with others and assign duties and seek advice, opinion, suggestions and recommendations and the like for the purpose of operations of the Trust and to define their powers, functions and compensation from time to time.
t. To undertake and carry on any other work which may seem to the Board capable of being conveniently carried on in connection with the promotion of the objects of the Trust.
u. To decide all questions arising in connection with, out of, and in the course of, the administration of the Trust or relating to the interpretation of these presents, or the administration and management of any institution established, managed or maintained by the Trust; or concerning any matter relating to, connected with or arising out of these presents.  The decision of the Board of Trustees on all or any of the matters aforesaid shall be final and binding.
v. To do all acts, deeds, matters and things as are deemed necessary, incidental or conducive to the attainment of all or any of the foregoing objects.`;

const ADMIN_12 = `a)	The Trust Funds shall be administered and managed in accordance with provisions contained in these presents and the rules and the regulations which may from time to time be framed by the Trustees hereunder and it is hereby agreed and declared that, the Trustees or Trustee for the time being of these presents shall have power from time to time to alter or to add to the said rules and regulations, or any of the clauses, which shall not offend against the objects and purposes of these presents or be inconsistent therewith and are not repugnant in any manner whatsoever to the provisions of section 2(15), 11 to 13, or 80G or any other relevant provisions of the Income tax Act, 1961 as amended from time to time.  Further, no amendment shall be carried out without the prior approval of the Commissioner of Income tax in matters affecting the claim for benefits arising under the provisions of the Income tax Act, 1961.
b)	IT IS HEREBY EXPRESSLY AGREED AND DECLARED THAT the Trustees shall have the power by an unanimous resolution in that behalf to modify, enlarge or terminate any of the objects and purposes of these presents or any other power or provisions of these presents without however affecting in any way the general object and purpose of the Trust for utilizing the Trust Funds and the income of the Trust Funds for the charitable purpose only for the benefit of all without distinction of caste, creed and religion and to the intent that the Trust Fund and the Income thereof shall at all times hereafter be utilized for such charitable purposes only and not otherwise and on the Trustees resolving to terminate any particular object or purpose or any particular power or provision as aforesaid the same shall thereafter cause to be applicable but without prejudice to the rights of the Trustees by similar unanimous resolution to restore any such object or purpose, power or provisions either in the original form or with such modification thereto as the Trustees may consistently with the provision of this clause determine provided that, notwithstanding anything hereinbefore or hereinafter contained, the income as also corpus of the Trust Funds shall be applied and be applicable only to or for such charitable purposes and objects only and within such territories only and subject to such condition or limitation if any as may from time to time be laid down in the Income Tax Act, 1961 or any other Act governing the taxation of income as will ensure or make the Trust hereby established and its income as eligible for exemption from taxation under the Income Tax Act, 1961 or any replacement, re-enactment or modification thereof or under any Act governing taxation for the time being in force in India and further so that the Trust hereby established shall be to which the provisions of  Sections 80G of the Income Tax Act, 1961, or any replacement, re-enactment or modification thereof for the time being in force shall apply so that any donation thereto be recognized eligible for exemption or release from tax in regard to the Donor.`;

const AMEND_17 = `a)	The Board of Trustees shall be at liberty to add or alter or abrogate any of the provisions of this Deed of Declaration of Trust in a manner not inconsistent with the objects of the Trust by a vote of three-fourth majority of members of the Board of Trustees.
b)	No amendment to the Deed of Declaration of Trust shall be made which may prove repugnant to the provisions of Sections 2(5), 11 to 13 and 80G of the Income-Tax Act 1961.
c)	No amendment shall be carried out without the prior approval of the Commissioner of Income Tax or any other authority vested with such power under the Income Tax Act, 1961.`;

const DISSOLUTION_18 = `a)	The Trust may be dissolved with the consent of three-fourth (75%) of the members of the Board of Trustees present and voting at a duly convened meeting of the Board of Trustees.
b)	In the event of dissolution or winding up of the Trust, the assets remaining as on the date of dissolution shall under no circumstances be distributed among the members of the Board of trustees, but the same shall be transferred to another charitable trust or society, whose objects are similar to those of this Trust.`;

const paras = (block: string): Paragraph[] => block.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => para(s));

export async function renderTrustDocx(d: TrustInput): Promise<Buffer> {
  const [y, m, day] = d.dateExecution.split("-").map(Number);
  const dd = String(day).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const formattedDate = `${ordinal(day)} day of ${MONTHS[(m || 1) - 1]} ${y} (${dd}.${mm}.${y})`;
  const amountWords = numToWords(d.amountDeclared);
  const c: Paragraph[] = [];

  c.push(heading("DEED OF DECLARATION OF TRUST", true));
  c.push(para(`THIS DEED OF DECLARATION OF TRUST made and executed on this the ${formattedDate} in Bengaluru; `));

  c.push(para("BY:"));
  d.parties.forEach((p, i) => {
    c.push(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, children: [new TextRun({ text: `${i + 1}. ${p.name}, having Aadhaar: ${p.aadhaar} & PAN: ${p.pan}, aged ${p.age} years, residing at ${p.address}. hereinafter referred to as the “${p.designation}”.`, bold: true })] }));
  });

  c.push(para(`WHEREAS, the Author of the Trust is desirous of creating a Public trust to engage in public service and charitable activities including, but not limited to ${d.shortObjects}.`));
  c.push(para(`WHEREAS, pursuant to the above, the Author of the Trust herein declares a public charitable trust by setting up a sum of Rs. ${d.amountDeclared} (Rupees ${amountWords} only) as the Trust Property and transfers and delivers the same to the Board of Trustees constituted herein, to hold the same in trust for the objects hereinafter specified and subject to the terms and conditions stipulated hereinafter. `));
  c.push(para(b("NOW THEREFORE THIS DEED OF DECLARATION OF TRUST WITNESSETH AS FOLOWS:")));

  c.push(clause("1. NAME OF THE TRUST"));
  c.push(para(`The trust shall be known as “${d.trustName}”`));

  c.push(clause("2. ADDRESS OF THE TRUST"));
  c.push(para(`a) The office of the Trust shall be situated at ${d.trustAddress}.`));
  c.push(para("b) The Board of Trustees may, from time to time, at their discretion, shift the offices of the trust to such other place as they deem fit and necessary."));

  c.push(clause("3. OBJECTS OF THE TRUST"));
  c.push(para("The objects of the Trust are as follows:"));
  c.push(...bulletsFrom(d.detailedObjects));
  c.push(multiline("PROVIDED,\nThe application of the trust funds and assets shall be made without distinction of nationality, religion, caste, class, creed or gender."));

  c.push(clause("4. TRUST FUND"));
  c.push(para(`The Author of the Trust hereby declares a sum of Rs. ${d.amountDeclared}/- (Rupees ${amountWords} only) as the Trust Fund and assigns, transfers and delivers the same to the Board of Trustees who shall stand possessed of the Trust Fund.`));

  c.push(clause("5. TRUST PROPERTY"));
  c.push(para("The Trust Property shall consist of the Trust Fund and all funds (which expression, wherever the context permits, shall hereafter include all investments in cash or in kind or in any other nature whatsoever into and for which the Trust Property or any part thereof may from time to time be converted or varied or exchanged and/or such other investments as may be held by the Board of Trustees from time to time in relation to these present with all income, property, additions and alterations thereof by using and/or investing such Trust Property) held in trust for the objects set-out herein with and subject to the provisions and conditions hereinafter contained in these presents."));

  c.push(clause("6. IRREVOCABILITY OF TRUST"));
  c.push(para("The Trust hereby created is not and shall not be revocable at any time and under any circumstances."));

  c.push(clause("7. BOARD OF TRUSTEES"));
  c.push(para("a. Board: The Trust shall be governed by a Board of Trustees (Board) consisting of no fewer than two (2) members and no more than fifteen (15) members.  The number of trustees may be determined from time to time by the Board of Trustees.  Presently, the Board of Trustee consists of two persons’ viz. the Author of the Trust and the Trustee."));
  c.push(para("b. Author: The Author of the Trust shall be Managing Trustee of the Trust and he shall be Trustee for life unless he resigns, or is otherwise incapacitated to function as a Trustee for whatever reasons in which case the Author of the Trust shall be entitled to nominate another person in his place as a Trustee. But the term of office of such nominee trustee shall be governed by the provisions and conditions contained in these presents. After the death or cessation of the Author of the Trust, the Managing Trustee shall be appointed by and amongst the Board of Trustees."));
  c.push(para("c. Chairperson: The Managing Trustee shall be and act as Chairperson of the Board of Trustees."));
  c.push(para("d. Election: The Author of the Trust shall appoint the first Board of Trustees.  Subsequent Trustees shall be elected by the affirmative vote of a majority of the Board of Trustees at a meeting of the Board of Trustees called for such purpose. "));
  c.push(para("e. First Board of Trustees: The Author of the Trust hereby appoints, constitutes and nominates the first Board of Trustees consisting of the following:"));
  c.push(multiline(d.boardTrustees));
  c.push(para("f. Term of Trustees: A Trustee shall hold office for a term of five (5) years and shall cease to hold office upon completion of the term unless re-appointed by the Board for further term of five years. A retiring trustee shall be eligible for reappointment."));
  c.push(para("g. A single Trustee may constitute the Board only when the number of trustees is reduced to one. In such case, the single trustee shall appoint another person as a trustee to increase the strength of the Board to the minimum of two (2)."));
  c.push(para("h. In the event not even a single trustee exists or all positions of trustees are vacant for whatever reason, the power of appointing the minimum number of trustees shall vest with the Court having jurisdiction over the place where the offices of the Trust is situated."));
  c.push(para("i. Removal of Trustees: A trustee may be removed with or without cause at any time by the Author/Managing Trustee of the Trust, with the consent of the majority of the Board of Trustee. After the demise or retirement of the Author or Managing Trustee, removal of any trustee shall be with the consent of a majority of the Board of Trustees, provided that notice of the Board’s proposed action is included in the notice of the meeting at which such vote is taken."));
  c.push(para("j. Cessation as Trustee: A trustee shall cease to hold office if such trustee:"));
  c.push(...bulletsFrom(CESSATION));
  c.push(para("k. Honorary position: The office of Trustees shall be honorary and persons holding such office shall not be entitled to draw any remuneration for carrying out any of the duties as Trustees, but shall be entitled to reimbursement of expenses incurred by them.  A Trustee serving as a manager will be reimbursed for living expenses and other costs pertaining to the management of the Projects. Trustees should avoid conflicts of interest or even the appearance of conflict of interest, which would affect the public’s perception of the organization."));

  c.push(clause("8. OFFICERS OF THE TRUST"));
  c.push(para("The following shall serve as the officers of the Trust:"));
  c.push(...d.officers.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(`· ${s}`)] })));
  c.push(para("a. Election/Vacancies: The officers shall be elected by the Board, from among the Trustees, at the first yearly meeting of the Board.  Any vacancy occurring in any office, for whatever reason, shall be filled by the Board and any Trustee so elected shall fulfill the term of his/her predecessor."));
  c.push(para("b. Removal: Any officer may be removed by the Board of Trustees whenever in its judgment the best interest of the Trust will be served thereby; provided, however, that removal of an officer shall be without prejudice to his contract rights, if any."));
  c.push(para("c. Powers and Duties of Officers:  Subject to the control of the Board of Trustees, all officers as between themselves and the Trust shall have such authority and perform such duties in the management of the property and affairs of the Trust as may be provided in this Trust Deed or by resolution of the Board not inconsistent with this Trust Deed and, to the extent not so provided, as generally pertain to their respective offices. "));
  c.push(para("d. The Managing Trustee shall have general oversight of the activities of the Trust.  The Managing Trustee shall preside over the meetings of the Board of Trustees."));
  c.push(para("e. The Secretary shall be responsible for the keeping of an accurate record of the proceedings of all meetings of the Board of Trustees.  He/she shall maintain all statutory registers and file statutory returns from time to time.  The Secretary is empowered to implement the decisions of the Board or otherwise act on its behalf.  S/he is authorized to sue and to be sued on behalf of the Trust.  S/he shall do such other work as usually pertain to such office. "));
  c.push(para("f. The Treasurer shall manage the funds of the Trust and maintain all financial records. S/he shall furnish all financial information as may be required by the Board from time to time and shall do such other work as usually pertain to such office. Any Trustee can hold more than one position / post until additional trustees are appointed."));
  c.push(para("g. Agents and Employees:  The Board of Trustees may appoint agents and employees who shall have such authority and perform such duties as may be prescribed by the Board.  The Board may remove any agent or employee at any time with or without cause.  Removal shall be without prejudice to such person’s contract rights, if any.  The appointment of such person as an agent or employee shall not itself create contract rights."));

  c.push(clause("9. MEETINGS OF THE BOARD OF TRUSTEES"));
  c.push(para("a. Meetings.  The Board will meet as often as necessary but at least once a quarter i.e. once every three (3) months. Any one of the officers of the Trust can call a meeting. The Board may act without a meeting if the members consent in writing."));
  c.push(para("b. Meetings by conference Telephone (or Teleconference).  Any or all Trustees may participate in a meeting of the Board or of a committee of the Board by means of conference telephone, skype or by any means of communications by which all persons participating in the meeting are able to hear one another, and such participation shall be counted as present in person at the meeting."));
  c.push(para("c. Notice of Meeting.  Notice may be given by written notice delivered personally, phone call/text or sent by mail/email to each Trustee at his or her address as shown by the records."));
  c.push(para("d. Waiver of Notice.  Any Trustee may waive notice of any meeting either before or after the time notice would have been required.  A Trustee’s attendance at any meeting shall constitute his or her acceptance of such meeting and its purpose. Except as specifically required by the Trust Deed neither the business to be transacted at, nor the purpose of, any regular or special meeting of the Board of Trustees need be specified in the notice, or waiver of notice, of such meetings."));
  c.push(para("e. Informal Action by Trustees.  Any action required or permitted to be taken by the Board may be taken without a meeting if consent in writing, setting forth the action so taken, shall be signed by a majority of the trustees authorizing the action.  Such consent shall have the same force and effect as a unanimous vote.  The signed documents setting forth such consent by a majority of the trustees shall be filed with the minutes of proceedings of the Board."));
  c.push(para("f. Quorum.  Unless a greater proportion is required by law or this Trust Deed, one-third of the total number of Trustees then in office shall constitute a quorum for the transaction of business.  Except as otherwise provided by law or by the Trust Deed, the act of a majority of the trustees present at a meeting at which a quorum is present shall be the act of the Board. In case of a tie in voting while passing a resolution, the Chairman shall have an additional vote as a casting vote either in favor of the resolution or opposed to it."));

  c.push(clause("10. CIRCULAR RESOLUTION"));
  c.push(para("A circular resolution issued by the Secretary and/or by the Chairman on any subject which they deem urgent and signed by a majority of the Trustees shall in all respects be as valid and binding as a resolution passed at a meeting of the Board of Trustees duly convened and constituted, and such resolution shall not be invalidated by reason of want of notice or any other case whatsoever. "));

  c.push(clause("11. POWERS OF THE BOARD OF TRUSTEES"));
  c.push(para("With a view to carrying out the objects of the Trust and to augment its funds and in discharge of their duties, and without prejudice to the generality of any power hereby or by law conferred or implied or vested in them as Trustees, the Board of Trustees shall have the following powers:"));
  c.push(...paras(POWERS_11));

  c.push(clause("12. ADMINISTRATION OF THE TRUST IN CONSONANCE WITH THE PROVISIONS OF THE INCOME TAX ACT:"));
  c.push(...paras(ADMIN_12));

  c.push(clause("13. INDEMNITY"));
  c.push(para("The members of the Board of Trustees shall be indemnified against all expenses and loses incurred or suffered or any payments made by them in the administration of the Trust and such expenses, loses and payments shall be borne by the Trust and none of the members of the Board of Trustees shall in any way be personally liable or responsible for the same. "));

  c.push(clause("14. APPLICATION OF INCOME "));
  c.push(para("The funds and income of the Trust shall be solely utilized towards the achievement of the objects of the Trust and no portion of it shall be utilized by way of dividend or distribution of profits to the Trustees or to any other person. "));

  c.push(clause("15. INVESTMENT "));
  c.push(para("The funds of the Trust shall be invested in the modes specified under the provisions of Section 11(1)(d) read with Section 13(5) of the Income Tax Act, 1961."));

  c.push(clause("16. ACCOUNTS & AUDIT  "));
  c.push(para("There shall be maintained all accounts of the Trust regularly. The accounts shall be closed at the end of every financial year. The accounts shall be duly audited by a Chartered Accountant or a firm of Chartered Accountants and placed before the Board every year."));

  c.push(clause("17. AMENDMENTS"));
  c.push(...paras(AMEND_17));

  c.push(clause("18. DISSOLUTION"));
  c.push(...paras(DISSOLUTION_18));

  c.push(clause("19. APPLICATION OF THE TRUST"));
  c.push(para("IT IS HEREBY DECLARED that the Trust applies to the whole of India. The Trust is established for the benefit of public at large and the class of people mentioned above without discrimination of nationality, caste, religion, creed or gender."));

  c.push(clause("20. ACCEPTANCE BY THE TRUSTEES"));
  c.push(para("The Trustees above named has accepted this Trust."));

  c.push(para(b("IN WITNESS WHEREOF THE FOUNDER OF THE TRUST HAS SET HIS SIGNATURE ON THE DAY, MONTH AND YEAR HEREINABOVE MENTIONED.")));
  c.push(multiline(d.signatures, 720));
  c.push(para("WITNESSES"));
  c.push(multiline(d.witnesses, 720));

  return buildDoc(c, { font: "Calibri" });
}

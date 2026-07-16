import { z } from "zod";
import { Paragraph, TextRun, AlignmentType } from "docx";
import { buildDoc, clause, heading, para, spacer, gridTable, pageBreak, b, t, type Cell } from "../docx";
import { ordinal, dayMonthYear } from "../date";

// Partnership Deed (+ Form 1 registration) — faithful port of tools/partnership.py.
// The source emits two files; here they are one .docx separated by a page break.

const partyZ = z.object({
  name: z.string().min(1),
  aadhaar: z.string().regex(/^\d{12}$/, "Aadhaar must be exactly 12 digits"),
  pan: z.string().regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, "PAN must be in format ABCDE1234F"),
  age: z.number().int().min(18),
  relationType: z.enum(["s/o", "d/o", "w/o", "h/o"]),
  relationName: z.string().min(1),
  address: z.string().min(1),
  capital: z.number().nonnegative(),
  profitShare: z.number().min(0).max(100),
});

export const partnershipZ = z
  .object({
    dateExecution: z.string().min(1), // ISO
    businessType: z.string().min(1),
    shortObjects: z.string().min(1),
    businessActivity: z.string().min(1),
    partnershipName: z.string().min(1),
    placeBusiness: z.string().min(1),
    partners: z.array(partyZ).min(2).max(10),
    remuneration: z.number().nonnegative(),
    drawingsLimit: z.string().min(1),
    managingPartnerIdx: z.number().int().nonnegative(),
    bankOperatorIdx: z.number().int().nonnegative(),
    witness1Name: z.string().min(1),
    witness1Address: z.string().min(1),
    witness2Name: z.string().min(1),
    witness2Address: z.string().min(1),
  })
  .refine((d) => Math.abs(d.partners.reduce((a, p) => a + p.profitShare, 0) - 100) < 0.01, { message: "Profit shares must total 100%" });

export type PartnershipInput = z.infer<typeof partnershipZ>;
type Party = z.infer<typeof partyZ>;

const RELATION: Record<string, string> = { "s/o": "Son of Shri", "d/o": "Daughter of Shri", "w/o": "Wife of Shri", "h/o": "Husband of Shri" };
const designationOf = (i: number) => `${ordinal(i + 1).toUpperCase()} PARTNER`;
const relationOf = (p: Party) => `${RELATION[p.relationType]} ${p.relationName}`;
const inr = (n: number) => n.toLocaleString("en-IN");

function deedChildren(d: PartnershipInput, formattedDate: string): (Paragraph | ReturnType<typeof gridTable>)[] {
  const parties = d.partners;
  const c: (Paragraph | ReturnType<typeof gridTable>)[] = [];

  // e-stamp space
  c.push(new Paragraph({ spacing: { after: 3800 }, children: [] }));
  c.push(heading("Deed of Partnership"));
  c.push(para(`This deed of partnership is made and executed on ${formattedDate} by and between:`));

  parties.forEach((p, i) => {
    c.push(
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${i + 1}. Shri ` }),
          new TextRun({ text: p.name.toUpperCase(), bold: true }),
          new TextRun({ text: `, ${relationOf(p)} aged about ${p.age} years, having PAN: ${p.pan}, residing at ${p.address}, hereinafter referred to as ` }),
          new TextRun({ text: designationOf(i).toUpperCase(), bold: true }),
          new TextRun({ text: "." }),
        ],
      }),
    );
  });

  c.push(para("(The expression the First Party, Second Party and Third Party, unless they are repugnant to the context or meaning thereof, mean and include their respective heirs, executors, administrators and assigns.)"));
  c.push(para(`Whereas, the parties hereto have agreed to carry on the business of ${d.shortObjects}. `));
  c.push(para(b("NOW THIS PARTNERSHIP DEED WITNESSETH as follows:")));

  c.push(clause("1. NAME"));
  c.push(para(t("That the business in partnership shall be carried on under the name and style of “"), b(d.partnershipName), t("”.")));

  c.push(clause("2. BUSINESS ACTIVITY"));
  c.push(para(d.businessActivity));

  c.push(clause("3. PLACE OF BUSINESS"));
  c.push(para(`The principal place of the partnership business will be situated at ${d.placeBusiness}.`));

  c.push(clause("4. DURATION OF PARTNERSHIP"));
  c.push(para("The duration of the partnership will be at will."));

  c.push(clause("5. Capital Contribution & Interest on Capital"));
  const totalCapital = parties.reduce((a, p) => a + p.capital, 0);
  const capRows: Cell[][] = [
    [{ text: "SL No", bold: true }, { text: "Name of Partner", bold: true }, { text: "Capital Contribution (In Rs.)", bold: true }],
    ...parties.map((p, i) => [{ text: String(i + 1).padStart(2, "0") }, { text: `Shri ${p.name}`, bold: true }, { text: String(p.capital) }]),
    [{ text: "Total", bold: true }, { text: "" }, { text: String(totalCapital), bold: true }],
  ];
  c.push(gridTable(capRows));
  c.push(para(`That the initial capital of Rs.${inr(totalCapital)} shall be brought in by partners as above and as well as any further necessary funds required for Partnership business shall be contributed or arranged by the Partners in such manner as may be mutually agreed upon by and between the Partners from time to time. Interest at the rate of 12 percent per annum or as may be prescribed under Section 40 (b) of the Income Tax Act, 1961 or any other applicable provisions as may be in force under the Income tax assessment of Partnership firm for the relevant accounting period shall be payable to the Partners on account standing to the credit of the account of the Partners. Such interest shall be calculated and credited to the account of each partner at the close of each accounting year. However, in case of loss or lower income, rate of interest can be nil or lower than 12 percent as may be agreed upon by and between the Partners from time to time.`));

  c.push(clause("6. Remuneration"));
  c.push(para(`That a remuneration of Rs.${inr(d.remuneration)}/- per month as salary shall be paid to all the partners on monthly basis.`));

  c.push(clause("7. Drawings by Partner"));
  c.push(para(`Each partner shall be entitled to draw out of the partnership business any sum or sums of money not exceeding Rs. ${d.drawingsLimit} per annum for his own use, such sums to be duly accounted for on each succeeding settlement of accounts and division of profits of the partnership and if any excess drawings are found on any such settlement, the same shall be refunded by the partner(s) concerned (with interest at 5% percent per annum).`));

  c.push(clause("8. PROFIT SHARING RATIO"));
  const allEqual = parties.every((p) => p.profitShare === parties[0].profitShare);
  const profitStr = allEqual ? "equally" : parties.map((p, i) => `${p.profitShare}% to ${designationOf(i).toLowerCase()}`).join(" ");
  c.push(para(t("The profit or loss of the firm shall be shared "), b(profitStr), t(" among all the partners and transferred to the partner’s current account.")));

  c.push(clause("9. MANAGEMENT"));
  const mp = parties[Math.min(d.managingPartnerIdx, parties.length - 1)];
  const mpDesig = designationOf(Math.min(d.managingPartnerIdx, parties.length - 1));
  c.push(para(t("The "), b(`[${mpDesig.toLowerCase()}] viz. Shri ${mp.name}`), t(" of the firm shall be Managing Partner and he will look after all the day to day transactions of the firm and any legal activities in the name of the firm and the remaining partners shall co-operate to do so.")));

  c.push(clause("10. OPERATION OF BANK ACCOUNTS"));
  const bo = parties[Math.min(d.bankOperatorIdx, parties.length - 1)];
  const boDesig = designationOf(Math.min(d.bankOperatorIdx, parties.length - 1));
  c.push(para(t("The firm shall open a current account in the name of "), b(d.partnershipName), t(" at any bank and such account shall be operated by the "), b(`[${boDesig.toLowerCase()}] viz. ${bo.name}`), t(" as declared from time to time to the Banks.")));

  c.push(clause("11. BORROWING"));
  c.push(para("The written consent of all Partners will be required for the partnership to avail credit facilities from any financial institution, Banking or Non-Banking institution or any private parties."));

  c.push(clause("12. ACCOUNTS"));
  c.push(para("The firms shall regularly maintain in the ordinary course of business, true and correct accounts of all its transactions and also of all its assets and liabilities, the property books of account, which shall ordinarily be kept at the firm’s place of business. The accounting year shall be the financial year from 1st April onwards and the balance sheet shall be properly audited and the same shall be signed by all the Partners. Every Partner shall have access to the books and the right to verify their correctness. "));

  c.push(clause("13. RETIREMENT"));
  c.push(para("If any partner, at anytime, during the subsistence of the partnership, be desirous of retiring from the firm, shall be competent to do so, provided he shall give at least one calendar month notice of his intention of doing so. The remaining partner shall pay to the retiring partner or his legal representatives of the deceased partner, the purchase money of his share in the assets of the firm, if any."));

  c.push(clause("14. DEATH OF PARTNER"));
  c.push(para("In the event of the death of any partners, one of the legal representatives of the deceased partner shall become the partner of the firm and in the event where the legal representative shows their denial to be appointed to the firm, they shall be paid the part of the purchase amount calculated as on the date of the death of the partner."));

  c.push(clause("15. ARBITRATION"));
  c.push(para("Whenever there is any difference of opinion or any dispute between the partners the partners shall refer the same to an arbitration of one person. The decision of the arbitration so nominated shall be final and binding on all partners, such arbitration proceedings shall be governed by Indian Arbitration Act, which is in force. "));

  c.push(para(b(`In witness whereof, this deed of partnership is signed sealed and delivered this ${formattedDate} at Bengaluru, Karnataka:`)));
  c.push(spacer());

  // Signatures table (nil borders): row0 blank, name, designation, address, blank
  const sigRows: Cell[][] = [
    parties.map(() => ({ text: "" })),
    parties.map((p) => ({ text: `Shri ${p.name.toUpperCase()}`, bold: true })),
    parties.map((_, i) => ({ text: designationOf(i).toUpperCase() })),
    parties.map((p) => ({ text: `Address: ${p.address}` })),
    parties.map(() => ({ text: "" })),
  ];
  c.push(gridTable(sigRows, { bordered: false, align: "center" }));
  c.push(spacer());

  // Witnesses table (nil borders)
  const witRows: Cell[][] = [
    [{ text: "WITNESS ONE", bold: true }, { text: "WITNESS TWO", bold: true }],
    [{ text: "" }, { text: "" }],
    [{ text: "Signature", bold: true }, { text: "Signature", bold: true }],
    [{ text: `Name: ${d.witness1Name}`, bold: true }, { text: `Name: ${d.witness2Name}`, bold: true }],
    [{ text: `Address: ${d.witness1Address}`, bold: true }, { text: `Address: ${d.witness2Address}`, bold: true }],
  ];
  c.push(gridTable(witRows, { bordered: false, align: "left" }));

  return c;
}

function form1Children(d: PartnershipInput, dateJoin: string): (Paragraph | ReturnType<typeof gridTable>)[] {
  const parties = d.partners;
  const name = d.partnershipName.toUpperCase();
  const mp = parties[Math.min(d.managingPartnerIdx, parties.length - 1)];
  const c: (Paragraph | ReturnType<typeof gridTable>)[] = [];

  c.push(heading("FORM NO. 1"));
  c.push(heading("(Rule 3)"));
  c.push(heading("THE INDIAN PARTNERSHIP ACT, 1932"));
  c.push(heading("Application for Registration of Firm "));
  c.push(para(t("Application for Registration of Firm by the Name "), b(name), t(", Presented and forwarded to the Registrar of Firm for filing by Shri "), b(mp.name), t(".")));
  c.push(para(`We, the undersigned being the partners of the firm ${name} hereby apply for registration of the said firm and for that purpose supply the following particulars in pursuance of section 58 of the Indian Partnership Act, 1932:-`));

  c.push(gridTable([[{ text: "The firm name", bold: true }, { text: name, bold: true }]], { align: "left" }));
  c.push(gridTable([
    [{ text: "Places of Business", bold: true }, { text: d.placeBusiness, bold: true }],
    [{ text: "\tOther Places - Nil", bold: true }, { text: "" }],
  ], { align: "left" }));

  c.push(gridTable([
    [{ text: "Name of partners in full", bold: true }, { text: "Date of joining the firm", bold: true }, { text: "Permanent address in full", bold: true }],
    ...parties.map((p, i) => [{ text: `${i + 1}. Shri ${p.name}`, bold: true }, { text: dateJoin }, { text: p.address }]),
  ], { align: "left" }));

  c.push(gridTable([[{ text: "Duration of the firm:-", bold: true }, { text: "Until wound up by partners by mutual consent.", bold: true }]], { align: "left" }));

  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "Signature of all partners", bold: true })] }));
  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `On behalf of ${name}`, bold: true })] }));

  // Names, max 3 per row
  const rows: Cell[][] = [];
  for (let i = 0; i < parties.length; i += 3) {
    rows.push(parties.slice(i, i + 3).map((p) => ({ text: p.name, bold: true })));
  }
  c.push(gridTable(rows, { bordered: false, align: "center" }));

  c.push(para(`Date: ${dateJoin}`));
  c.push(para("Place: Bengaluru."));

  // Declaration per partner, page-break separated
  parties.forEach((p, idx) => {
    c.push(heading("DECLARATION"));
    c.push(para(`I, Shri ${p.name.toUpperCase()}, ${relationOf(p)}, aged about ${p.age} years, having PAN: ${p.pan}, residing at ${p.address} do hereby declare that the above statement is true and correct to the best of my knowledge and belief.`));
    c.push(para(`Date: ${dateJoin}`));
    c.push(para("Signature"));
    c.push(spacer());
    c.push(heading("WITNESS"));
    c.push(para(b("Signature:")));
    c.push(para(b("Name:")));
    c.push(para(b("Address:")));
    if (idx < parties.length - 1) c.push(pageBreak());
  });

  return c;
}

export async function renderPartnershipDocx(d: PartnershipInput): Promise<Buffer> {
  const [y, m, day] = d.dateExecution.split("-");
  const formattedDate = dayMonthYear(d.dateExecution); // "5th July 2026"
  const dateJoin = `${day}.${m}.${y}`; // DD.MM.YYYY
  return buildDoc([...deedChildren(d, formattedDate), pageBreak(), ...form1Children(d, dateJoin)]);
}

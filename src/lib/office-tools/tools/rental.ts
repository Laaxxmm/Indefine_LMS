import { z } from "zod";
import { Paragraph, TextRun, AlignmentType } from "docx";
import { buildDoc, clause, heading, para, spacer, b, t, type Run } from "../docx";
import { MONTHS, ordinal, dayMonthYear, addDays } from "../date";
import { numToWords } from "../numToWords";

// Rental / Lease Agreement — faithful port of tools/rental.py.

export const rentalZ = z.object({
  place: z.string().min(1),
  agreementDate: z.string().min(1), // ISO yyyy-mm-dd
  premisesType: z.enum(["Residential", "Commercial"]),
  businessName: z.string().default(""),
  ownerName: z.string().min(1),
  ownerFather: z.string().min(1),
  ownerAadhaar: z.string().min(1),
  ownerAddress: z.string().min(1),
  tenantName: z.string().min(1),
  tenantFather: z.string().min(1),
  tenantAadhaar: z.string().min(1),
  tenantAddress: z.string().min(1),
  securityDeposit: z.number().positive(),
  rent: z.number().positive(),
  paymentMethod: z.string().min(1),
  otherChargesTitle: z.string().min(1),
  otherCharges: z.string().min(1),
  startDate: z.string().min(1), // ISO
  durationMonths: z.number().int().positive(),
  renewalIncrease: z.number().nonnegative(),
  natureUse: z.string().min(1),
  maintenance: z.string().min(1),
  scheduleAddress: z.string().min(1),
  facilities: z.string().min(1),
});
export type RentalInput = z.infer<typeof rentalZ>;

const inr = (n: number) => n.toLocaleString("en-IN");

// Split `text` so any occurrence of `needle` renders bold (used to emphasise the
// quoted business name inside the free-text "nature of use" clause).
function boldWithin(text: string, needle: string): Run[] {
  if (!needle || !text.includes(needle)) return [t(text)];
  const out: Run[] = [];
  text.split(needle).forEach((seg, idx) => {
    if (idx > 0) out.push(b(needle));
    if (seg) out.push(t(seg));
  });
  return out;
}

export async function renderRentalDocx(inp: RentalInput): Promise<Buffer> {
  const [ay, am, ad] = inp.agreementDate.split("-").map(Number);
  const formattedDate = `${ordinal(ad)} day of ${MONTHS[(am || 1) - 1]} ${ay}`;
  const premises = inp.premisesType; // "Residential" | "Commercial"
  const startStr = dayMonthYear(inp.startDate);
  const endStr = dayMonthYear(addDays(inp.startDate, inp.durationMonths * 30));
  const securityWords = numToWords(inp.securityDeposit);
  const rentWords = numToWords(inp.rent);
  const durationWords = numToWords(inp.durationMonths);
  const chargesTitle = inp.otherChargesTitle.toUpperCase();
  const quotedBusiness = inp.businessName ? `“${inp.businessName}”` : "";

  const children: (Paragraph)[] = [];

  // E-stamp space (no page break for rental — matches source)
  children.push(new Paragraph({ spacing: { after: 2880 }, children: [new TextRun({ text: "Space for E-Stamp", italics: true })] }));

  children.push(heading("RENTAL AGREEMENT", true));
  children.push(para(`This Rental Agreement is made and executed at ${inp.place} on the ${formattedDate} by and between:`));

  // Owner
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `Mr. ${inp.ownerName}`, bold: true }),
        new TextRun({ text: `, S/O ${inp.ownerFather}, Aadhaar No: ${inp.ownerAadhaar}, residing at ${inp.ownerAddress}.` }),
        new TextRun({ text: "Hereinafter called the ", break: 1 }),
        new TextRun({ text: "OWNER", bold: true }),
        new TextRun({ text: " of the " }),
        new TextRun({ text: "ONE PART", bold: true }),
        new TextRun({ text: ":" }),
      ],
    }),
  );
  children.push(spacer());
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun("AND")] }));
  children.push(spacer());

  // Tenant
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `Mr. ${inp.tenantName}`, bold: true }),
        new TextRun({ text: `, S/O ${inp.tenantFather}, Aadhaar No: ${inp.tenantAadhaar}, residing at ${inp.tenantAddress}.` }),
        new TextRun({ text: "Hereinafter referred to as The ", break: 1 }),
        new TextRun({ text: "TENANT", bold: true }),
        new TextRun({ text: " of the " }),
        new TextRun({ text: "OTHER PART", bold: true }),
        new TextRun({ text: ";" }),
      ],
    }),
  );
  children.push(spacer());
  children.push(para(b("WITNESSETH AS FOLLOWS:")));
  children.push(spacer());

  children.push(
    para(
      t("Whereas the tenant, who needed a "),
      b(`${premises} Premises`),
      t(" and the Owner, who is the sole and absolute owner of the schedule premises, agreed to let out the portion of schedule premises in consideration of the rent on the following terms and conditions."),
    ),
  );
  children.push(spacer());

  children.push(clause("1. SECURITY DEPOSIT"));
  children.push(para(`Whereas tenant has paid sum of Rs. ${inr(inp.securityDeposit)}/- (Rupees ${securityWords} only) towards security deposit, which has been received by way of Cash. The Owner hereby acknowledges the receipt of the Security amount, and the amount shall be refunded to the tenant at the time of vacating the premises without any interest, deducting the cost of damages, unpaid dues if any.`));
  children.push(spacer());

  children.push(clause("2. RENT"));
  children.push(para(`Whereas the tenant shall pay a monthly Rent of Rs. ${inr(inp.rent)}/- (Rupees ${rentWords} only) the rent payable on or before 05th of every month through ${inp.paymentMethod} only.`));
  children.push(spacer());

  children.push(clause(`3. ${chargesTitle}`));
  children.push(para(inp.otherCharges));
  children.push(spacer());

  children.push(clause("4. DURATION"));
  children.push(para(`Whereas the duration of this Rent Agreement shall be for a period of ${inp.durationMonths} (${durationWords}) months from ${startStr} to ${endStr}, but renewed with mutual consent of both the owner and the tenant with increase in ${inp.renewalIncrease}% rent to the previous rent paid and with a fresh agreement.`));
  children.push(spacer());

  children.push(clause("5. NATURE OF USE PERMITTED"));
  children.push(para(...boldWithin(inp.natureUse, quotedBusiness)));
  children.push(spacer());

  children.push(clause("6. MAINTENANCE"));
  children.push(para(inp.maintenance));
  children.push(spacer());

  children.push(clause("7. SUB-LEASE"));
  children.push(para("Whereas the tenant shall not sublet, underlet or part with the possession of the premises to anyone whomsoever."));
  children.push(spacer());

  children.push(clause("8. ADDITIONS/ALTERATIONS"));
  children.push(para("Whereas the tenant shall not alter or damage any portion of the premises without the permission of the owner."));
  children.push(spacer());

  children.push(clause("9. PAINTING"));
  children.push(para("Whereas painting charges shall be borne by the tenant at the time of vacating the premises or in case of failure the owner shall be at the liberty to deduct the painting charges from the advance amount while refunding."));
  children.push(spacer());

  children.push(clause("10. DEFAULT OF RENT AND BREACH OR PRIVILEGE"));
  children.push(para("If the Tenant commits any default to pay the rent regularly for more than three months (3) on the due dates or commit any default to observe or perform any of the terms hereto agreed, then the owner hereby reserves the right to terminate the tenancy, hereto granted to giving 2 month’s notice to the tenant and takeover the said premises"));
  children.push(spacer());

  children.push(clause("11. TERMINATION OF THE AGREEMENT"));
  children.push(para("Giving Three [3] months’ notice in writing may terminate the agreement by both sides."));
  children.push(spacer());

  children.push(clause("SCHEDULE PROPERTY"));
  children.push(para(
    t("The scheduled premise is situated at "),
    b(inp.scheduleAddress),
    t(`, and consists of ${premises} Space with ${inp.facilities}.`),
  ));
  children.push(spacer());

  children.push(para("In WITNESS WHEREAS both parties have set their respective hands to the agreement on the day, month, and year first above mentioned."));
  children.push(spacer());
  children.push(para("IN WITNESS WHEREOF the parties have affixed a signature to this rental agreement, on the date, month, and year first above written in the presence of the following witnesses."));
  children.push(spacer());

  children.push(para(b("WITNESSES")));
  children.push(spacer());
  children.push(new Paragraph({ indent: { left: 720 }, children: [new TextRun("1.")] }));
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: inp.ownerName, bold: true }), new TextRun({ text: "(LESSOR/OWNER)", bold: true, break: 1 })] }));
  children.push(spacer());
  children.push(new Paragraph({ indent: { left: 720 }, children: [new TextRun("2.")] }));
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: inp.tenantName, bold: true }), new TextRun({ text: "(LESSEE/TENANT)", bold: true, break: 1 })] }));

  return buildDoc(children);
}

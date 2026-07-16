import { z } from "zod";
import { Paragraph, TextRun, AlignmentType } from "docx";
import { buildDoc, clause, heading, para, gridTable, b, t, type Cell } from "../docx";
import { numToWords } from "../numToWords";

// Limited Liability Partnership Agreement — faithful port of tools/llp.py (Calibri).
// Note: the source has a plain (non-f) string with a literal `{designated_clause}` at
// clause 26 that is never interpolated; we interpolate the computed clause instead.

const BUSINESS_DESCS: Record<string, string> = {
  "Cloud chain": "Cloud chain services encompass the development, deployment, and management of blockchain-integrated cloud solutions. These activities include providing scalable infrastructure for decentralized applications, ensuring data security through encryption and smart contracts, and offering consulting on hybrid cloud-blockchain architectures to optimize business operations.\n\nThe LLP will engage in activities such as hosting distributed ledgers, facilitating tokenization of assets, and integrating APIs for seamless blockchain-cloud interactions. This includes catering to industries like finance, supply chain, and healthcare by enabling transparent, tamper-proof data management and automated transaction processing.\n\nAdditionally, the business will involve research and development in emerging technologies like layer-2 scaling solutions and zero-knowledge proofs, alongside training programs and support services to empower clients in adopting cloud chain technologies for enhanced efficiency and innovation.",
  "Real estate": "Real estate services involve the acquisition, development, management, and disposal of properties including residential, commercial, and industrial assets. Activities include site selection, feasibility studies, construction oversight, and leasing or sales facilitation to meet diverse client needs in urban and rural markets.\n\nThe LLP shall undertake property valuation, legal due diligence, and financing arrangements to support transactions, while also providing maintenance and renovation services to preserve asset value. This encompasses sustainable development practices, such as green building certifications, to align with environmental regulations and market demands.\n\nFurthermore, the business will include investment advisory for real estate portfolios, market analysis for trend forecasting, and partnership with stakeholders for joint ventures, ensuring comprehensive support throughout the property lifecycle for maximized returns and client satisfaction.",
  "IT consultancy": "IT consultancy services focus on advising clients on technology strategies, system implementations, and digital transformations. This includes assessing current IT infrastructures, recommending software and hardware solutions, and managing project rollouts to enhance operational efficiency and competitiveness.\n\nThe LLP will provide specialized expertise in areas like cybersecurity audits, cloud migration, and AI integration, delivering tailored reports and implementation roadmaps. Services extend to training end-users and ongoing support to ensure seamless adoption and minimal disruptions.\n\nIn addition, the business encompasses vendor management, cost optimization analyses, and compliance consulting for data protection regulations, fostering long-term partnerships that drive innovation and technological advancement across sectors.",
  "Trading": "Trading activities involve the buying, selling, and distribution of goods and commodities through wholesale, retail, and online channels. This includes sourcing products from manufacturers, negotiating supply agreements, and managing inventory to meet market demands efficiently.\n\nThe LLP shall engage in market research, pricing strategies, and logistics coordination to facilitate smooth trade operations, while ensuring quality control and compliance with import/export regulations. Services will cover both domestic and international trading, with a focus on high-demand categories like electronics, textiles, and consumer goods.\n\nMoreover, the business will include risk management through hedging and insurance, customer relationship management for repeat business, and expansion into e-commerce platforms, aiming to build a robust trading network for sustainable growth and profitability.",
  "Healthcare": "Healthcare services comprise the provision of medical consultations, diagnostic testing, and treatment facilities through clinics, hospitals, and telemedicine platforms. Activities include patient care management, preventive health programs, and specialized therapies to address community health needs.\n\nThe LLP will operate in areas such as general practice, radiology, and pharmacy services, adhering to stringent hygiene and ethical standards while leveraging technology for electronic health records and remote monitoring. This ensures accessible, high-quality care tailored to diverse demographics.\n\nAdditionally, the business involves health education workshops, insurance tie-ups, and research collaborations for innovative treatments, promoting holistic wellness and contributing to public health initiatives for improved outcomes and patient satisfaction.",
  "Financial services": "Financial services encompass banking, investment advisory, insurance brokerage, and wealth management to support individual and corporate financial goals. This includes portfolio analysis, loan facilitation, and risk assessment to provide customized solutions.\n\nThe LLP shall offer services like mutual fund distribution, tax planning, and retirement schemes, ensuring regulatory compliance and transparent reporting. Emphasis will be on digital tools for seamless transactions and real-time financial tracking.\n\nFurthermore, the business will engage in corporate finance consulting, mergers advisory, and ESG investment strategies, fostering trust through ethical practices and expert guidance for long-term financial security and growth.",
  "Human Resource management": "Human Resource management services involve recruitment, training, performance evaluation, and employee welfare programs to optimize organizational talent. Activities include talent acquisition strategies, onboarding processes, and HR policy development for compliance and efficiency.\n\nThe LLP will provide payroll processing, labor law advisory, and conflict resolution services, utilizing data analytics for workforce planning and diversity initiatives. This supports businesses in building resilient, motivated teams.\n\nIn addition, the business encompasses outplacement support, leadership development workshops, and succession planning, partnering with clients to enhance employee engagement and drive organizational success.",
  "Coworking space": "Coworking space operations entail the provision of flexible office environments, equipped with high-speed internet, meeting rooms, and communal facilities for freelancers, startups, and remote teams. Activities include space leasing on hourly, daily, or monthly bases, with amenities like printing and catering.\n\nThe LLP shall manage community events, networking sessions, and business support services to foster collaboration and innovation among members. Sustainability features, such as energy-efficient designs, will be integrated to appeal to eco-conscious users.\n\nMoreover, the business will involve membership management software for bookings and access control, expansion planning for multi-location setups, and partnerships with service providers, creating vibrant ecosystems for productivity and professional growth.",
  "Education": "Education services include curriculum development, classroom instruction, online courses, and skill-building workshops across K-12, vocational, and higher education levels. This encompasses teacher training, assessment tools, and extracurricular programs to nurture holistic learning.\n\nThe LLP will focus on personalized learning paths, incorporating technology like e-learning platforms and VR simulations for engaging experiences. Compliance with educational standards and accreditation will ensure quality delivery.\n\nAdditionally, the business involves research in pedagogy, corporate training tie-ups, and community outreach for underprivileged access, empowering learners with knowledge and skills for future success.",
  "Toys": "Toys manufacturing and distribution involve designing, producing, and retailing playthings for children, emphasizing safety, creativity, and educational value. Activities include material sourcing, prototyping, and quality testing to meet international standards.\n\nThe LLP shall engage in branding, packaging, and marketing through retail outlets and e-commerce, with seasonal collections and custom orders. Innovation in eco-friendly materials will differentiate offerings.\n\nFurthermore, the business will include licensing deals, export operations, and play therapy collaborations, delighting families while promoting child development through joyful, imaginative products.",
  "Clothing": "Clothing business comprises apparel design, manufacturing, and retail for casual, formal, and specialty wear across demographics. This includes fabric selection, pattern making, and production runs with ethical labor practices.\n\nThe LLP will handle supply chain management, trend forecasting, and omnichannel sales via stores and online platforms. Sustainable fashion initiatives, like upcycling, will be prioritized.\n\nIn addition, the business involves customization services, collaborations with designers, and global sourcing, delivering stylish, comfortable clothing that resonates with consumer lifestyles.",
};

const partnerZ = z.object({
  name: z.string().min(1),
  gender: z.enum(["Son", "Daughter"]),
  father: z.string().min(1),
  age: z.number().int().min(18),
  pan: z.string().regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, "PAN must be in format ABCDE1234F"),
  din: z.string().default("N/A"),
  address: z.string().min(1),
  role: z.enum(["Continuing", "New", "Resigning"]),
  contribution: z.number().positive(),
  profitShare: z.number().min(0).max(100),
});

export const llpZ = z
  .object({
    llpType: z.enum(["Reconstitution", "New LLP"]),
    llpName: z.string().min(1),
    state: z.string().min(1),
    businessType: z.string().min(1),
    partners: z.array(partnerZ).min(2).max(5),
  })
  .refine((d) => Math.abs(d.partners.reduce((a, p) => a + p.profitShare, 0) - 100) < 0.01, { message: "Profit shares must total 100%" })
  .refine((d) => !(d.llpType === "Reconstitution" && d.partners.every((p) => p.role === "Resigning")), { message: "At least one partner must be Continuing or New" });

export type LlpInput = z.infer<typeof llpZ>;
type Partner = z.infer<typeof partnerZ> & { index: number };

const PARTY_ORD = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH"];
const ORD_TITLE = ["First", "Second", "Third", "Fourth", "Fifth"];

const CLAUSES = `Admission of New Partner:
7. No Person may be introduced as a new partner without the consent of all the existing partners. Such Incoming partner shall give his prior consent to act as Partner of the LLP.
8. The Contribution of the partner may be tangible, intangible, moveable or immoveable property or other benefits/ rights brought or by way of agreement or contract for services, and the incoming partner shall bring minimum contribution as agreed between the existing partners and incoming partner(s).
9. The Profit-sharing ratio of the incoming partner(s) shall be decided by the existing partners and conveyed to the new partner(s) at the time of admission.
Rights of Partner:
10. All the partners shall have the rights, title and interest in the assets of the LLP in the proportion of their Profit-sharing ratio.
11. Every partner has a right to have access to and to inspect and to take copy of any books of the LLP.
12. Each of the partners of the LLP shall be entitled to carry on his/her own business independent of the businesses of the LLP after obtaining the approval of other partners of the LLP.
13. The LLP shall have perpetual succession. Death, retirement or insolvency of any partner shall not dissolve the LLP.
14. On retirement of a partner, the retiring partner shall be entitled to full payment in respect of all his rights, title and interest in the partnership as provided herein. However, upon insolvency of a partner his or her rights, title and interest in the LLP shall come to an end. Upon the death of any of the partners herein any one of his or her heirs will be admitted as a partner of the LLP in place of such deceased partner. The heirs, executors and administrators of such deceased partners shall be entitled to and shall be paid the full payment in respect of the right, title and interest of such deceased partner.
15. On the death of any partner, if his /her heir opts not to become the partner, the surviving partner/s shall have the option to purchase the contribution of the deceased partner in the LLP.
Duties of Partners:
16. Every partner shall account to the LLP for any benefit derived by him without the consent of the LLP from any transaction concerning the LLP, or from any use by him of the property, name or any business connection of the LLP.
17. Every partner shall indemnify the LLP and the other existing partner(s) for any loss caused to it/them, by his fraud in the conduct of the business of the LLP.
18. Each partner shall render true accounts and full information of all things affecting the LLP to any partner or his legal representatives.
19. In case any of the Partners of the LLP desires to transfer or assign his interest or shares in the LLP he has to offer the same to the remaining partners by giving 15 days’ notice. In the absence of any communication by the remaining partners the concerned partner can transfer or assign his share in the market.
20. No partner shall without the written consent of the LLP-
i. Employ any money, goods or effects of the LLP or pledge the credit thereof, except in the ordinary course of business and upon the account or for the benefit of the LLP.
ii. Lend money or give credit on behalf of the LLP or to have any dealings with any person(s), Limited Liability Partnership(s) or firm(s) whom the other partner previously in writing has forbidden trusting or dealing with. Any loss incurred through any breach of provisions shall be made good with the LLP by the partner incurring the same.
iii. Enter into any bond or become surety or security with or for any person or do knowingly or cause to be done anything whereby the LLP property or any part thereof may be seized.
iv. Assign, mortgage or charge his or her share in the LLP or any asset or property thereof or make any other person a partner therein.
v. Compromise or compound or (except upon payment in full) release or discharge any debt due to the LLP except upon the written consent given by the other partners.
Meeting:
21. The meeting of the Partners may be called by sending 15 days’ prior notice to all the partners at their residential address or by e-mail at the e-mail IDs provided by the individual Partners in writing to the LLP. In case any partner is a foreign resident the meeting may be conducted by serving 15 days’ prior notice through e-mail. Provided the meeting may be called at shorter notice, if majority of the partners agree in writing to the same either on or before the scheduled time of the meeting.
22. The meeting of Partners shall ordinarily be held at the registered office of the LLP or at any other place as per the convenience of partners.
23. With the written consent of all the partners, a meeting of the Partners may be conducted through Teleconference.
24. The LLP shall ensure that decisions taken by it are recorded in the minutes within thirty days of taking such decisions and are kept and maintained at the registered office of the LLP.
25. Each partner shall—
i. Punctually pay and discharge the separate debts and engagement and indemnify the other partners and the LLP assets against the same and all proceedings, costs, claim and demands in respect thereof.
ii. Give time and attention as may be required for the fulfillment of objectives of the LLP business.
Duties of Designated Partner:
26. {designated_clause}
27. The Designated Partners shall be responsible for the doing of all acts, matters and things as are required to be done by the LLP in respect of compliance of the provisions of this Act including filing of any document, return, statement and the like pursuant to the provisions of Limited Liability Partnership Act, 2008.
28. The Designated Partners shall be responsible for the doing of all acts arising out of this agreement.
29. The LLP shall pay such remuneration to the Designated Partner as may be decided by the Partners, for rendering his/her services as such.
30. The LLP shall indemnify and defend its partners and other officers from and against any and all liability in connection with claims, actions and proceedings (regardless of the outcome), judgment, loss or settlement thereof, whether civil or criminal, arising out of or resulting from their respective performances as partners and officers of the LLP, except for the gross negligence or willful misconduct of the partner or officer seeking indemnification.
Cessation of existing Partners:
31. Partner may cease to be partner of the LLP by giving a notice in writing of not less than thirty days to the other partners of his/her intention to resign as partner.
32. No Partners can expel any partner except in the situation where any partner has been found guilty of carrying of activity/business of the LLP with fraudulent purpose.
33. The LLP can be wound up with the consent of all the partners subject to the provisions of Limited Liability Partnership Act, 2008.
Extent of Liability of the LLP:
34. The LLP is not bound by anything done by a partner in dealing with a person if—
i. The partner in fact has no authority to act for the LLP in doing a particular act; and
ii. The person knows that he has no authority or acts without knowing the authority or believes without ascertaining the fact.
Miscellaneous Provisions:
35. The LLP shall indemnify each partner in respect of payments made and personal liabilities incurred by him—
i. In the ordinary and proper conduct of the business of the limited liability partnership; or
ii. In or about anything necessarily done for the preservation of the business or property of the limited liability partnership.
36. The books of accounts of the firm shall be kept at the registered office of the LLP for the reference of all the partners.
37. The accounting year of the LLP shall be from 1st April of the year to 31st March of subsequent year. The first accounting year shall be from the date of incorporation of this Limited Liability Partnership till 31st March of the subsequent year.
a. The Bank Account may be opened in one or more banks and the same shall be operated Jointly or independently by the Designated Partners.
38. All disputes between the partners or between the Partner(s) and the LLP arising out of the Limited Liability Partnership Agreement, which cannot be resolved in terms of this agreement shall be referred for arbitration as per the provisions of the Arbitration and Conciliation Act, 1996 (26 of 1996).`;

const SCHEDULE_I = [
  "1. To enter into any arrangement and to negotiate, enter into, make and perform contracts of every kind and description, for and on behalf of clients or to organize for such arrangements or negotiations, with any government, central, state, quasi-governmental, judicial, quasi-judicial, local, foreign or public body or person or authority or with any privy individuals, firm, association, etc., as may seem conducive and to obtain from any such government, authority, person, company or any other entity any concessions, grants, decrees, rights, charters, contracts, licenses, powers and privileges whatsoever and to work, develop, carryout, exercise and turn to account the same for gain or otherwise.",
  "2. To purchase, take on lease or in exchange, hire or otherwise acquire real or personal property, movable or immovable properties and rights or privileges necessary for the promotion of the main objects and to construct, maintain and alter buildings and erections necessary for the work of the LLP.",
  "3. Subject to the applicable laws in force and other consents as may be required by law, to borrow or raise money for the purpose of the LLP on such terms and on such security as may be considered fit.",
  "4. Subject to such consents as may be required by law, to sell, let out, mortgage, dispose off or turn to account all or any of the property or assets of the LLP as may be thought expedient, for the promotion of its objects.",
  "5. To invest the surplus monies of the LLP not immediately required for its purpose in or upon such investments, securities or properties, movable or immovable, as may be considered fit, subject nevertheless to such conditions (if any) and such consents (if any), as may for the time being be imposed or required by law and subject also as hereinafter provided.",
  "6. Subject to the laws in force, to borrow, raise or receive money on loan, secured or unsecured, at interest or otherwise, in such manner as the LLP may think fit and to secure the repayment of any such money borrowed, raised, received or owing by mortgage, pledge, charge or lien upon all or any of the property, assets or revenues of the LLP (both present and future), and give the lenders or creditors the power for sale and other powers as may seem expedient and to purchase, redeem or pay off any such securities and also by a similar mortgage, charge or lien, to secure and guarantee the performance by the LLP, other persons, firm or company, of any obligations undertaken by the LLP or any other person, firm or company, as the case may be.",
  "7. Subject to the applicable laws in force to lend and advance money or give credit to such persons or companies and on such terms and may seem expedient, and in particular to employees, customers and others having dealing with the LLP and to guarantee performance of any contract or obligations and payment of money of or by such persons or companies and generally to give guarantee and indemnity and to invest and deal with the moneys of the LLP in such manner as may from time to time be determined.",
  "8. To open and maintain bank accounts and/or to draw, make, accept, endorse, discount, execute and issue promissory notes, bills of exchange, bills of lading, warrants, debentures, letters of credit and other negotiable or transferable instruments.",
  "9. To purchase, take on lease or in exchange, hire or otherwise acquire and to hold and deal with, any movable or immovable property (including actionable claims, patents, patent rights, inventions, shares, stocks, debentures) or obligation of any LLP and to spend money in experimenting upon, testing or improving any patents, invention or rights, and distribution of assets or division of profits, of distribution any such property amongst the partners of this LLP on its winding up",
  "10. To undertake research and development programmes, experiments in any field which the LLP may consider useful or remunerative and conducive to the attainment of the main objects.",
  "11. To subcontract with any public or private entities or public-private partnerships for the delivery of work or for the promotion and attainment of its objects.",
  "12. To obtain or assist in obtaining patent rights or privileges for any inventions in India, and/or elsewhere and to purchase or otherwise acquire inventions patents, patent rights or privileges, trademarks, designs, licenses, protections, concessions, subsidies and other kinds of intangible or intellectual property (ies) which the LLP may think proper to acquire, and/or pay for the same such consideration as the LLP may think fit.",
  "13. To subscribe, purchase or otherwise acquire and undertake all or any part of the business, property and liabilities of any person, firm, association, LLP, Company (ies), body (ies) corporate, trust(s) or other entities as deemed fit, and as consideration for the same to pay cash or issue any share or obligation(s) of the LLP, and in connection with any such transaction to undertake any liabilities relating to the business or property acquired.",
  "14. To amalgamate or merge with any other LLP or Company (ies) or enter into partnership or in to any arrangements with other companies, firms, association of persons or body of individuals.",
  "15. To form, incorporate or promote any LLP or companies, whether in India or in foreign country and to pay all or any of the costs and expenses incurred in connection with any such promotion or incorporation, and to remunerate any person or entity in any manner it shall think fit for services rendered in this regard.",
  "16. To obtain any provisional order or Act of Legislation for enabling the LLP to carry out or effect any of its objects or for effecting any modification of the LLP’s constitution or for any other purpose which may seem expedient and to oppose any proceedings or application which may seem calculated, directly or indirectly, to prejudice the LLP’s interest.",
  "17. To support, subscribe or to donate or otherwise provide aid to any benevolent, charitable, national, public or other objects, funds, institutions, trusts, society, clubs, or organizations, subject to the applicable laws in force.",
  "18. To take part in the management, supervision or control of the business or other operations of any other institute, educational body, body corporate, LLP, Company, firm, association, person, pool, group, cartel, in pursuance of the objects of the LLP.",
  "19. To establish or assist in establishing chairs, faculties or departments of scientific and technical communication (or such other title within the objects of the LLP as may be thought fit) at any universities or other seats of learning.",
  "20. To organize and promote seminars, conferences, exhibitions, meetings, workshops and symposia on the subject which the LLP may think necessary, within the objects of the LLP.",
  "21. To consult, cooperate and collaborate with any persons, associations, societies, institutions, foreign bodies corporate, companies, firms or other organizations established or to be established in India or elsewhere, by way of joint collaboration/ joint venture or in any other way, for the purpose of furthering the objects of the LLP.",
  "22. To provide information and service to and for industry, professionally interested bodies, and other members of the public and to this end to establish and maintain a library and collection of literature, films and other material of interest in furtherance of the objects of the LLP.",
  "23. To employ experts to investigate, examine into the conditions, prospects, value character and circumstances of any business concern(s) and undertaking and generally of any assets, property or rights, with the object of finding out suitable solutions.",
];

const SCHEDULE_II = [
  "Any crucial decision that affects long term future of the partnership would need consent of at least three-fourth of the total number of partners. Examples of some crucial long-term decisions are:",
  "Deciding remuneration of a partner",
  "Taking on an “investment” engagement – where partners know that would-be loss-making engagement in the beginning itself,",
  "Change in branding logo/ marketing communication,",
  "Expenditure above Rs. 1 Lakh,",
  "Employ any money, goods or effects of the LLP or pledge the credit thereof except in the ordinary course of business and upon the account or for the benefit of the LLP.",
  "Lend money or give credit on behalf of the LLP or to have any dealings with any persons, LLP or firm whom the other partner previously in writing have forbidden it to trust or deal with. Any loss incurred through any breach of provisions shall be made good with the LLP by the partner incurring the same.",
  "Enter into any bond or becomes surety or security with or for any person, or do knowingly or cause to be done anything whereby the LLP property or any part thereof may be seized.",
  "Assign, mortgage or charge his or her share in the LLP or any asset or property thereof or make any other person a partner therein.",
  "Compromise or compound or (except upon payment in full) release or discharge any debt due to the LLP except upon the written consent given by the other partner.",
  "All partnership decisions, of whatever size needs to have at least 1 founding partner’s approval and this cannot be delegated.",
];

export async function renderLlpDocx(d: LlpInput): Promise<Buffer> {
  const partners: Partner[] = d.partners.map((p, i) => ({ ...p, index: i + 1 }));
  const recon = d.llpType === "Reconstitution";
  const totalContrib = partners.reduce((a, p) => a + p.contribution, 0);
  const totalWords = numToWords(totalContrib);

  // Designated partners selection (ported from the source's generate handler).
  const continuing = partners.filter((p) => p.role === "Continuing");
  const news = partners.filter((p) => p.role === "New");
  const firstDp = continuing[0] ?? news[0] ?? partners[0];
  const remaining = partners.filter((p) => p.index !== firstDp.index);
  let secondDp: Partner | undefined;
  for (const p of remaining) {
    if (p.role === "New") { secondDp = p; break; }
    if (p.role === "Resigning" && !secondDp) secondDp = p;
    else if (!secondDp) secondDp = p;
  }
  secondDp = secondDp ?? remaining[0];
  const designatedText = `\t1. ${firstDp.name}\n\n\t2. ${secondDp.name}`;
  const designatedClause = `The ${ORD_TITLE[firstDp.index - 1]} Party and ${ORD_TITLE[secondDp.index - 1]} Party shall act as the Designated Partners of the LLP in terms of the requirement of the Limited Liability Partnership Act, 2008.`;

  const c: (Paragraph | ReturnType<typeof gridTable>)[] = [];

  // E-stamp + page break
  c.push(new Paragraph({ spacing: { after: 2880 }, children: [new TextRun({ text: "Space for E-Stamp", italics: true })] }));
  c.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }));

  if (recon) {
    c.push(heading("LLP RECONSTITUTION AGREEMENT", true));
    c.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "(As per Section 23(4) of LLP Act, 2008)", bold: true })] }));
  } else {
    c.push(heading("LIMITED LIABILITY PARTNERSHIP AGREEMENT", true));
  }

  c.push(para("THIS Agreement of LLP made at Bangalore on this eighteenth day of September 2025, BETWEEN:"));

  // Partners
  partners.forEach((p, i) => {
    const gender = p.gender === "Son" ? "Son" : "Daughter";
    let role = `${PARTY_ORD[i]} PARTY`;
    if (recon) role += ` / ${p.role.toUpperCase()} PARTNER`;
    c.push(
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${i + 1}. ${p.name}, having DIN: ${p.din}, PAN: ${p.pan}, ${gender} of ${p.father}, aged about ${p.age} years, residing at ${p.address}, India. `, bold: true }),
          new TextRun({ text: "Wherever the context so meets/used shall mean and include his or her heirs, legal representatives, successors, administrators, power of attorney holders, if any, assigns, or any one claiming through or under him etc., hereinafter referred to as the " }),
          new TextRun({ text: `${role},`, bold: true }),
        ],
      }),
    );
  });
  c.push(para("(ALL THE ABOVE PARTIES SHALL BE COLLECTIVELY REFERRED TO AS PARTNERS)"));

  const introText = d.llpType === "New LLP" ? "forming" : "reconstituting";
  const noun = d.llpType === "New LLP" ? "formation" : "reconstitution";
  c.push(para(`NOW the above parties are interested in ${introText} a Limited Liability Partnership under the Limited Liability Partnership Act, 2008 and that they intend to write down the terms and conditions of the said ${noun} and:`));
  c.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "IT IS HEREBY AGREED BY AND BETWEEN THE PARTIES HERETO AS FOLLOWS", italics: true })] }));

  c.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `1. A Limited Liability Partnership shall be carried on in the name and style of '${d.llpName}' and hereinafter referred to as “the `, bold: true }),
        new TextRun({ text: "LLP", bold: true, underline: {} }),
        new TextRun({ text: "”." }),
      ],
    }),
  );

  c.push(para(b(`2. The LLP shall have its registered office in the state of ${d.state}, as mentioned in incorporation documents and/or at such other place or places, as shall be agreed to by majority of the partners from time to time.`)));
  c.push(para(b(`3. The contribution of the LLP shall be Rs. ${totalContrib}/- (Rupees ${totalWords} Only) which shall be contributed by the Partners in the manner specified below. `)));

  // Contribution table
  const contribRows: Cell[][] = [
    [{ text: "Partner", bold: true }, { text: "Contribution", bold: true }],
    ...partners.map((p) => [{ text: p.name }, { text: `Rs. ${p.contribution} /-\n\n(Rupees ${numToWords(p.contribution)} only)` }]),
  ];
  c.push(gridTable(contribRows, { align: "left" }));
  c.push(para("Each partner's contribution to or capital withdrawal from, the partnership shall be credited, or debited, respectively, to that partner's capital account."));
  c.push(para("Profit Sharing Ratio is as follows:"));

  const profitRows: Cell[][] = [
    [{ text: "Partner", bold: true }, { text: "Share", bold: true }],
    ...partners.map((p) => [{ text: p.name }, { text: `${p.profitShare} %` }]),
  ];
  c.push(gridTable(profitRows, { align: "left" }));

  c.push(para(b("4. The LLP shall have a seal to be affixed on documents as defined by Partners under the signature of any of the Designated Partners.")));
  c.push(para(b("5. The business of the LLP shall be as follows:")));
  (BUSINESS_DESCS[d.businessType] ?? "").split("\n\n").map((s) => s.trim()).filter(Boolean).forEach((s) => c.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(s)] })));

  c.push(clause("Designated Partners:"));
  c.push(para(b("6. The following persons shall be the Designated Partners of the LLP:")));
  c.push(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, children: designatedText.split("\n").map((ln, i) => new TextRun({ text: ln, bold: true, break: i > 0 ? 1 : undefined })) }));

  // Clauses 7-38
  const clausesFilled = CLAUSES.replace("{designated_clause}", designatedClause);
  clausesFilled.split("\n").forEach((line) => {
    const s = line.trim();
    if (!s) return;
    if (s.endsWith(":")) {
      c.push(clause(s));
    } else {
      const indent = /^(i{1,3}|iv|v)\./.test(s) ? 1080 : /^a\./.test(s) ? 360 : 0;
      c.push(new Paragraph({ indent: indent ? { left: indent } : undefined, spacing: { after: 120 }, children: [new TextRun(s)] }));
    }
  });

  c.push(para(b("IN WITNESS WHEREOF, the parties have put their respective hands the day and year first hereinabove written")));
  c.push(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, children: partners.flatMap((p, i) => {
    const party = `${PARTY_ORD[i]} PARTY${recon ? ` / ${p.role.toUpperCase()} PARTNER` : ""}`;
    const lines = [`${p.name}`, `DIN: ${p.din}`, `(${party})`];
    const runs = lines.map((ln, li) => new TextRun({ text: ln, bold: true, break: li > 0 || i > 0 ? 1 : undefined }));
    if (i > 0) runs.unshift(new TextRun({ text: "", break: 1 })); // blank line between partners
    return runs;
  }) }));

  c.push(para("WITNESS:"));
  c.push(gridTable([
    [{ text: "1" }, { text: "2" }],
    [{ text: "Signature:" }, { text: "Signature:" }],
    [{ text: "Name:" }, { text: "Name:" }],
    [{ text: "Address:" }, { text: "Address:" }],
    [{ text: "" }, { text: "" }],
  ]));

  // Schedule I
  c.push(heading("SCHEDULE I", true));
  c.push(para(t("ANCILLARY OR OTHER BUSINESS CARRIED ON BY "), t(d.llpName), t("(A) THE BUSINESS INCIDENTAL OR ANCILLARY TO THE ATTAINMENT OF THE MAIN BUSINESS ARE:")));
  SCHEDULE_I.forEach((item) => c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: item, bold: true })] })));

  // Schedule II
  c.push(heading("SCHEDULE II", true));
  c.push(para("MATTERS TO BE DECIDED BY A RESOLUTION PASSED BY A MAJORITY IN NUMBER OF THE PARTNERS"));
  SCHEDULE_II.forEach((item) => c.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: item, bold: true })] })));

  return buildDoc(c, { font: "Calibri" });
}

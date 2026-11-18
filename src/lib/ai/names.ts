// Deterministic name helpers for the anonymizer dictionary (DPDP, ADR-006 class A: names of
// individuals; a proprietor's trade name identifies the proprietor, so party names are masked too).
//
//   partyEntry(value)           one value from a parsed party / supplier / customer / employer /
//                               payer / holder column → a dictionary entry, or null for non-names
//                               ("Cash", "-", "Rent", a number)
//   narrationNameSpans(text)    payee / payer names inside bank narrations after a payment-rail
//                               keyword ("NEFT-RAJESH KUMAR SHARMA-SAL OCT" → RAJESH KUMAR SHARMA)
//   narrationNames(text)        the same as dictionary entries (agents' dictionaryTerms hooks)
//   dedupeDictionary(entries)   one entry per value (case-insensitive), longest first
//
// Used by the runner's per-run dictionary (agents' dictionaryTerms hooks) and by the anonymizer's
// narration masker (a backstop for names no dictionary knows). Pure: no I/O.
import type { DictionaryEntry, DictionaryKind } from "./types";

/** Words that make a name an organisation (upper case, punctuation stripped). */
export const ORG_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "PLC", "OPC",
  "TRADERS", "TRADING", "ENTERPRISES", "ENTERPRISE", "INDUSTRIES", "INDUSTRY", "AGENCIES", "AGENCY", "ASSOCIATES",
  "SERVICES", "SOLUTIONS", "SYSTEMS", "TECHNOLOGIES", "TECHNOLOGY", "INFOTECH", "EXPORTS", "IMPORTS", "STORES",
  "MART", "CENTRE", "CENTER", "HOSPITAL", "CLINIC", "PHARMA", "PHARMACY", "FOODS", "MOTORS", "ELECTRICALS",
  "ELECTRONICS", "TEXTILES", "CONSTRUCTIONS", "CONSTRUCTION", "BUILDERS", "DEVELOPERS", "TRUST", "SOCIETY",
  "FOUNDATION", "SONS", "BROS", "BROTHERS", "GROUP", "HUF", "BANK", "FINANCE", "FINANCIAL", "INSURANCE",
  "LOGISTICS", "SUPPLIES", "SUPPLY", "TRANSPORT", "VENTURES", "HOLDINGS", "CONSULTANTS", "CONSULTANCY",
  "MILLS", "ENGINEERS", "AUTOMOBILES", "JEWELLERS", "PRINTERS", "LABS", "LABORATORIES", "STUDIOS", "TRAVELS", "TOURS",
  "HOTELS", "BAKERY", "FARMS", "AGRO", "MEDICALS", "DISTRIBUTORS", "DEALERS", "INFRA", "INFRASTRUCTURE", "PROJECTS",
  "ESTATES", "REALTY", "PROPERTIES", "COMMUNICATIONS", "NETWORKS", "INFOSYSTEMS",
]);

/** Generic organisation words left out of an organisation's distinctive core ("HDFC Bank Ltd" → "HDFC"). */
export const ORG_GENERIC_WORDS: ReadonlySet<string> = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "PLC", "OPC", "THE", "AND",
  "OF", "INDIA", "M", "S", "MS", "MESSRS", "BANK", "HUF",
]);

/** Honorifics stripped before a person's name is varied. */
export const HONORIFICS: ReadonlySet<string> = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SRI", "SMT", "KUM", "KUMARI", "KM", "M", "S", "MESSRS", "CA", "ADV"]);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/**
 * Words that are never (part of) a person's name in a register or narration: payment rails,
 * banking and accounting terms, expense heads, months. Upper case.
 */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  ...MONTHS,
  "NEFT", "RTGS", "IMPS", "UPI", "NACH", "ECS", "ACH", "MMT", "INFT", "INF", "TRF", "TFR", "CHQ", "CHEQUE", "CLG", "CMS", "BIL", "BILLPAY", "POS", "INB", "MOB", "ATM",
  "P2A", "P2M", "P2P", "CR", "DR", "TO", "BY", "FROM", "FOR", "THE", "AND", "OF", "IN", "AT", "ON", "A", "AN", "VIA", "AGAINST", "TOWARDS",
  "HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "YES", "PNB", "BOB", "CANARA", "UNION", "IDFC", "INDUSIND", "FEDERAL", "RBL", "IOB", "UCO", "BOI", "CBI",
  "IFSC", "REF", "REFNO", "NO", "TXN", "UTR", "RRN", "ID", "PAYMENT", "PAYMENTS", "PAY", "PAID", "RECEIVED", "RECEIPT", "TRANSFER", "FUND", "FUNDS",
  "CREDIT", "DEBIT", "CASH", "DEPOSIT", "WITHDRAWAL", "CHARGES", "CHGS", "CHG", "FEE", "FEES", "GST", "IGST", "CGST", "SGST", "TDS", "TCS", "TAX", "TAXES",
  "INTEREST", "INT", "SALARY", "SALARIES", "SAL", "WAGES", "BONUS", "RENT", "EMI", "LOAN", "BILL", "BILLS", "INVOICE", "INV", "ADVANCE", "REFUND",
  "REVERSAL", "RETURN", "RETURNS", "FILED", "TURNOVER", "RECEIPTS", "DIVIDEND", "DIVIDENDS", "SAVINGS", "DEPOSITS", "SELF", "OWN", "ACCOUNT", "AC", "SB", "CA", "OD", "CC", "ELECTRICITY", "BESCOM", "WATER", "PHONE", "MOBILE", "INTERNET",
  "BROADBAND", "RECHARGE", "PREMIUM", "OFFICE", "EXPENSE", "EXPENSES", "EXP", "PURCHASE", "PURCHASES", "SALES", "SALE", "MATERIAL", "MATERIALS",
  "FUEL", "PETROL", "DIESEL", "TRAVEL", "FOOD", "MAINTENANCE", "REPAIR", "REPAIRS", "MISC", "OTHERS", "OTHER", "SUNDRY", "VENDOR", "SUPPLIER",
  "CUSTOMER", "PARTY", "AMOUNT", "BAL", "BALANCE", "OPENING", "CLOSING", "BROUGHT", "FORWARD", "TOTAL", "NET", "GROSS", "CAPITAL", "DRAWINGS",
  "SUSPENSE", "DEBTORS", "CREDITORS", "PAYABLE", "RECEIVABLE", "PROVISION", "DEPRECIATION", "STOCK", "INVENTORY", "JOURNAL", "CONTRA", "VOUCHER",
  "NA", "NIL", "NONE", "UNKNOWN", "MISCELLANEOUS", "GENERAL", "MONTHLY", "QUARTERLY", "ANNUAL", "PAYTM", "GPAY", "PHONEPE", "BHIM", "AMAZON",
]);

const PUNCT = /[.,'’&()/-]+/g;
const upperWord = (w: string) => w.replace(PUNCT, "").toUpperCase();

/** Client-master and staff names for one job's masking dictionary (production: name-directory.ts). */
export type NameDirectory = {
  forJob(job: { jobTaskId: string; clientCode: string; clientName: string }): Promise<DictionaryEntry[]>;
};

/** Does any word of the name mark an organisation ("Pvt", "Ltd", "LLP", "Traders", "Bank" …)? */
export function isOrgName(value: string): boolean {
  return value.split(/[\s,]+/).some((w) => ORG_SUFFIX_WORDS.has(upperWord(w)));
}

/**
 * A party value from a parsed column → a dictionary entry, or null when it is not a name: too
 * short, no letters, a stopword ("Cash", "Rent", "Sundry"), or only stopwords and numbers.
 */
export function partyEntry(value: string | null | undefined, kind?: DictionaryKind): DictionaryEntry | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (v.length < 3 || v.length > 160 || !/\p{L}/u.test(v)) return null;
  const words = v.split(/[\s,]+/).map(upperWord).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1 && (words[0].length < 4 || NAME_STOPWORDS.has(words[0]))) return null;
  if (words.every((w) => NAME_STOPWORDS.has(w) || /\d/.test(w) || w.length < 2)) return null;
  return { value: v, kind: kind ?? (isOrgName(v) ? "ORG" : "NAME") };
}

/** Each value through partyEntry; nulls dropped. */
export function partyEntries(values: Iterable<string | null | undefined>, kind?: DictionaryKind): DictionaryEntry[] {
  const out: DictionaryEntry[] = [];
  for (const v of values) {
    const e = partyEntry(v, kind);
    if (e) out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------ narrations

/** Payment-rail keywords after which a bank narration names the payee / payer. */
const RAILS = "NEFT|RTGS|IMPS|UPI|NACH|ECS|ACH|MMT|INFT|TRF|TFR|CHQ|CHEQUE|CLG|CMS|BIL|BILLPAY|INB|MOB";
const RAIL_RE = new RegExp(`(?<![A-Za-z0-9])(?:${RAILS})(?![A-Za-z0-9])`, "gi");
const RAIL_WORD = new RegExp(`^(?:${RAILS})$`, "i");
/** Segment breaks inside a narration; the anonymizer's claimed spans (U+E000 / U+E001) count as breaks too. */
const BREAK_CODES = new Set([0x2d, 0x2f, 0x3a, 0x7c, 0x2a, 0x23, 0x5f, 0x2c, 0x3b, 0x0a, 0x09, 0x28, 0x29, 0x5b, 0x5d, 0xe000, 0xe001]);
const NAME_WORD = /^[A-Z][A-Za-z.'’&]*$/;
/** How far after the rail keyword a name may start. */
const NARRATION_REACH = 160;

export type NameSpan = { start: number; end: number; kind: DictionaryKind };

/**
 * Names in bank narrations: after a payment-rail keyword, skip reference segments (digits, short
 * codes, stopwords), then take up to six capitalised words that are not stopwords. Two or more
 * words (or a word plus an organisation suffix) make a name. Offsets index `text`.
 */
export function narrationNameSpans(text: string): NameSpan[] {
  const out: NameSpan[] = [];
  let after = 0;
  RAIL_RE.lastIndex = 0;
  for (let m = RAIL_RE.exec(text); m; m = RAIL_RE.exec(text)) {
    if (m.index < after) continue;
    const span = nameAfter(text, m.index + m[0].length);
    if (span) {
      out.push(span);
      after = span.end;
      RAIL_RE.lastIndex = Math.max(RAIL_RE.lastIndex, span.end);
    }
  }
  return out;
}

function nameAfter(text: string, from: number): NameSpan | null {
  const limit = Math.min(text.length, from + NARRATION_REACH);
  let i = from;
  let segments = 0;
  while (i < limit && segments < 6) {
    // one segment: up to the next break
    let j = i;
    while (j < limit && !BREAK_CODES.has(text.charCodeAt(j))) j++;
    const found = nameInSegment(text, i, j);
    if (found === "stop") return null; // the next narration starts here: it gets its own scan (keeps this linear)
    if (found) return found;
    segments++;
    i = j + 1;
  }
  return null;
}

function nameInSegment(text: string, start: number, end: number): NameSpan | "stop" | null {
  const words: { s: number; e: number; w: string }[] = [];
  for (let i = start; i < end; ) {
    while (i < end && text.charCodeAt(i) <= 32) i++;
    const s = i;
    while (i < end && text.charCodeAt(i) > 32) i++;
    if (i > s) words.push({ s, e: i, w: text.slice(s, i) });
  }
  let k = 0;
  // leading junk: references, digits, short codes, stopwords
  while (k < words.length && (/\d/.test(words[k].w) || upperWord(words[k].w).length < 2 || NAME_STOPWORDS.has(upperWord(words[k].w)) || !NAME_WORD.test(words[k].w))) {
    if (RAIL_WORD.test(words[k].w)) return "stop";
    k++;
  }
  const name: typeof words = [];
  let org = false;
  for (; k < words.length && name.length < 6; k++) {
    const w = words[k].w;
    const u = upperWord(w);
    if (!NAME_WORD.test(w) || !u) break;
    if (ORG_SUFFIX_WORDS.has(u)) {
      if (!name.length) break;
      org = true;
      name.push(words[k]);
      continue;
    }
    if (NAME_STOPWORDS.has(u)) break;
    if (org) break; // nothing after the suffix
    name.push(words[k]);
  }
  const core = name.filter((w) => !ORG_SUFFIX_WORDS.has(upperWord(w.w))).length;
  if (core >= 2 || (core >= 1 && org)) return { start: name[0].s, end: name[name.length - 1].e, kind: org ? "ORG" : "NAME" };
  return null;
}

/** Narration names as dictionary entries. */
export function narrationNames(text: string | null | undefined): DictionaryEntry[] {
  if (!text) return [];
  return narrationNameSpans(text).flatMap((s) => {
    const e = partyEntry(text.slice(s.start, s.end), s.kind);
    return e ? [e] : [];
  });
}

/** One entry per value (case- and whitespace-insensitive; the first kind wins), longest first. */
export function dedupeDictionary(entries: Iterable<DictionaryEntry | null | undefined>): DictionaryEntry[] {
  const seen = new Map<string, DictionaryEntry>();
  for (const e of entries) {
    if (!e) continue;
    const value = e.value.replace(/\s+/g, " ").trim();
    if (value.length < 2) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, { value, kind: e.kind });
  }
  return [...seen.values()].sort((a, b) => b.value.length - a.value.length || (a.value < b.value ? -1 : 1));
}

// ------------------------------------------------------------------ person names in free text (re-audit NEW-1)
//
// A name typed into a free-text column — an item description ("Consultancy by Yashwanth Gowda
// Patil for Oct"), a ledger ("Rent - Ravindra Hegde"), a Form 16 line ("Name of Employee: RAJESH
// KUMAR SHARMA"), a UPI narration, a note, a file name — is in no party column, so no dictionary
// knows it. personNameSpans() finds such names deterministically, with five rules:
//
//   honorific  Mr / Mrs / Ms / Dr / Shri / Smt / Sri / Kum. (+ M/s for a firm) then 1–4 name words
//   label      `Name of Employee:`, `Payee:`, `employee:`, `landlord:`, `proprietor:` … then the value
//   json       "employee": "…" (string values of name-like keys)
//   rail       the payee after UPI/P2A/<digits>/ and in NEFT- / IMPS- / RTGS- segments (one word is
//              enough there), plus the multi-word narration payees of narrationNameSpans()
//   sequence   2–4 capitalised (Title or ALL CAPS) words in a row, none of them a business,
//              accounting, product, place or instruction word (BUSINESS_WORDS); an organisation
//              suffix ("Traders", "Pvt Ltd") makes it an organisation
//
// "Conservative" means: a word in BUSINESS_WORDS always breaks a sequence, so ordinary register
// text ("Professional Fees", "Office Rent", "Input Tax Credit", "Tamil Nadu") is never a name.
// Over-masking a capitalised phrase costs the model a little context; a missed name is a DPDP
// breach — so the list is extended when a business phrase trips the rule, never the rule weakened.
// Used three ways: the runner / router add the names it finds to the masking dictionary (so every
// variant is masked everywhere), mask() masks the spans in place, and the router's leak gate runs it
// again over the MASKED payload (a name that survives stops the call). Linear in the text length.
// Limits: ASCII (Latin-script) names only — a name written in Devanagari or Kannada is caught only
// when the dictionary knows it (anonymizer transliteration); a single capitalised word outside a
// label / honorific / payment rail is never treated as a name.

/** Business, accounting, product, place, calendar and instruction words: never part of a person's name in a sequence. Upper case. */
const BUSINESS_TEXT = `
A AN THE AND OR BUT NOR OF IN ON AT TO BY FOR FROM WITH WITHOUT WITHIN INTO ONTO UPON OVER UNDER ABOVE BELOW BETWEEN AMONG
AFTER BEFORE DURING SINCE UNTIL TILL AS PER VIA VS IS ARE WAS WERE BE BEEN BEING HAS HAVE HAD DO DOES DID DONE NOT NO YES ALL
ANY EACH EVERY SOME NONE OTHER SUCH THIS THAT THESE THOSE IT ITS WE OUR YOU YOUR THEY THEIR HE HIS SHE HER I MY ME US THEM
WHO WHOM WHOSE WHICH WHAT WHEN WHERE WHY HOW IF THEN ELSE THAN ALSO ONLY JUST VERY MORE MOST LESS LEAST MANY MUCH FEW NEW OLD
SAME NEXT LAST FIRST SECOND THIRD FOURTH FIFTH ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE HUNDRED THOUSAND
LAKH CRORE MILLION BILLION ABOUT AGAIN ALREADY ALWAYS NEVER NOW HERE THERE UP DOWN OUT OFF CAN COULD MAY MIGHT MUST SHALL
SHOULD WILL WOULD PLEASE KINDLY NOTE SEE REFER FOLLOWING ETC IE EG OK DEAR SIR MADAM REGARDS THANKS THANK HELLO HI TEAM
MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY SUNDAY MON TUE TUES WED THU THUR THURS FRI SAT SUN TODAY YESTERDAY TOMORROW
WEEK DAY DAYS MONTH YEAR QUARTER HALF FY AY PY QTR QRMP YTD MTD YOY MOM PERIOD DATE DATED TIME
ACCOUNT ACCOUNTING ACCRUED ACCRUAL ADJUSTMENT ADVANCE AGGREGATE ALLOWANCE AMORTISATION AMORTIZATION ANNEXURE APPLICABLE
APPROVED ARREARS ASSESSMENT ASSET AUDIT AUDITED AUDITOR AVAILABLE AVAILED BASE BASIC BENEFIT BLOCKED BOOK BRANCH BUSINESS
CALCULATION CARRIED CATEGORY CENTRAL CESS CHALLAN CHAPTER CHARGE CHARGEABLE CHECK CHECKLIST CLAIM CLAIMED CLASS
CLASSIFICATION CODE COLLECTED COLUMN COMMISSION COMPLIANCE COMPOSITION COMPUTATION CONSULTING CONTRACT CONTRACTOR
CONTRIBUTION CONVEYANCE CORPORATE COST COUNT COURIER CREDITOR CURRENT CUSTOMS DEBTOR DEDUCTED DEDUCTION DEFERRED DEMAND
DESCRIPTION DETAIL DIFFERENCE DIRECT DIRECTOR DISCOUNT DISALLOWANCE DISALLOWED DOCUMENT DONATION DUE DUTY EARNINGS
EDUCATION ELIGIBLE ELIGIBILITY INELIGIBLE EMPLOYEE EMPLOYER ENTERTAINMENT ENTRY ENTRIES EQUITY ESI ESIC EPF PF ESTIMATE
ESTIMATED EXEMPT EXEMPTED EXEMPTION EXPENDITURE EXPORT EXTERNAL FILING FINAL FIXED FORM FREIGHT FURNITURE GIFT GOODS
GRATUITY GROSS HEAD HOUSE HOUSING HRA IMPORT INCOME INDIRECT INPUT INTEGRATED INTER INTERNAL INTRA INVESTMENT ISSUED ITEM JOB
LABOUR LABOR LAND LATE LEASE LEDGER LEGAL LEVY LIABILITY LIABILITIES LICENCE LICENSE LIMIT LIST LOCAL LONG LOSS MACHINERY
MANAGEMENT MANUFACTURING MARKETING MATCH MATCHED MEDICAL MEMBERSHIP MISMATCH NATURE NEGATIVE NON NUMBER OBJECTIVE OPERATING
ORDER ORIGINAL OUTPUT OUTSTANDING OUTWARD INWARD OVERDUE PACKING PAGE PART PARTICULARS PARTNER PAYABLE PENALTY PENDING
PENSION PERQUISITE PERSONAL PETTY PLACE PLANT POSTAGE PREPAID PREVIOUS PRINCIPAL PRINTING PRIOR PROFESSION PROFESSIONAL
PROFIT PROPERTY PURCHASE QUANTITY QTY QUARTERLY RATE REBATE RECEIVABLE RECONCILIATION RECONCILED RECOVERY REGISTER
REGISTERED REGISTRATION REGULAR REIMBURSEMENT RELATED REMUNERATION RENTAL REPORT RESERVE RETAINER REVENUE REVERSE REVERSED
ROUND ROYALTY SCHEDULE SECTION SECURED SECURITY SERVICE SETTLEMENT SHARE SHORT SITTING SOFTWARE SOURCE SPECIAL STAFF STAMP
STANDARD STATE STATEMENT STATIONERY STATUS STATUTORY SUB SUBSCRIPTION SUMMARY SUPPLY SURCHARGE TAXABLE TELEPHONE TERM TRADE
TRAINING TRANSACTION TRAVELLING TRAVELING UNIT UNSECURED UTILITY VALUE VEHICLE WELFARE WORK WRITTEN YEARLY ZERO RATED
RECIPIENT CLEARING INSTRUMENT NARRATION REFERENCE DEBITED CREDITED BORROWING LENDING CONTINGENT CONCERN GOING
BOARD MEETING MINUTES RESOLUTION AGM EGM PAYABLES RECEIVABLES INVENTORIES WORKING PREPAYMENT PROVISIONAL ALLOTMENT ALLOTTED
PREFERENCE DEBENTURE PREMIUM AUTHORISED AUTHORIZED SUBSCRIBED CALLED PAIDUP FORFEITED BUYBACK SURPLUS DEFICIT
EBITDA PAT PBT EPS NAV CAGR MSME UDYAM LUT SEZ DTA EOU NRI AOP BOI FIRM COMPANY INDIVIDUAL PROPRIETORSHIP PARTNERSHIP
TDS TCS GST ITC RCM HSN SAC IGST CGST SGST UTGST GSTR GSTIN UIN PAN TAN CIN DIN LLPIN ARN IRN EWB EWAY ITR AIS TIS CBDT CBIC
MCA ROC CA CS CMA ICAI SOP SOPS FAQ TBD NOS PCS UOM UQC KG KGS MT LTR LTRS SQFT SQ FT MM CM INR RS USD AMT VAL VCH DT OB CB
BF CF IND GAAP IFRS CARO SA II III IV V VI VII VIII IX X XI XII XIII XIV XV OTP KYC CKYC AML URN UTR SRN ACK EVC DSC PDF CSV
XLSX XLS JSON TXT DOC DOCX ZIP XML HTML URL API ERP MIS CRM HR IT IP ID IDS NA NIL OUT IN EST GMT IST UTC AM PM
TALLY PRIME ZOHO EXCEL MICROSOFT GOOGLE WINDOWS SAP ORACLE QUICKBOOKS BUSY MARG GSTN PORTAL ONLINE OFFLINE WEBSITE EMAIL MAIL
WHATSAPP FLIPKART SWIGGY ZOMATO UBER OLA AIRTEL JIO VODAFONE IDEA BSNL LIC NSDL CDSL BSE NSE SEBI RBI IRDA IRDAI EPFO
QUESTION ANSWER EVIDENCE CITE DOCUMENTS UNTRUSTED END BEGIN START STOP CLASSIFY LINE ROW FILE SHEET FIELD KEY FORMAT
SCHEMA TASK RULE POINT REVIEWER REVIEW PREPARER MANAGER CLIENT AGENT MODEL AI CONTEXT PROMPT INSTRUCTIONS INSTRUCTION SYSTEM
USER ASSISTANT TRUE FALSE NULL UNDEFINED INSUFFICIENT ABSTAIN PASS FAIL FAILED WARN WARNING BLOCK INFO HIGH LOW MEDIUM RISK
FLAG ERROR ISSUE ACTION REQUIRED OPTIONAL MISSING FOUND CHECKED VERIFIED PREPARED DRAFT FINALISED FINALIZED SUBMITTED
APPROVE REJECT REJECTED ACCEPTED NOTED NOTICE REPLY APPEAL HEARING SUBMISSION COMPUTE SUBTOTAL GRAND
TAX INVOICE DEBIT CREDIT BILL RECEIPT VOUCHER TABLE APPENDIX ENCLOSURE ATTACHMENT ATTACHED
IGNORE OVERRIDE ROLE RESPOND
ROAD RD STREET ST LANE CROSS MAIN NAGAR LAYOUT COLONY SECTOR BLOCK FLOOR PHASE STAGE EXTENSION APARTMENT APTS
TOWER COMPLEX BUILDING PLAZA CIRCLE MARG CHOWK BAZAAR BAZAR MARKET PARK GARDEN ENCLAVE VIHAR PURAM PALYA HALLI PET
PETE TALUK TALUKA DISTRICT DIST VILLAGE POST PO TOWN CITY HOBLI WARD ZONE AREA INDUSTRIAL ESTATE OPPOSITE OPP NEAR BEHIND
ANDHRA PRADESH ARUNACHAL ASSAM BIHAR CHHATTISGARH GOA GUJARAT HARYANA HIMACHAL JHARKHAND KARNATAKA KERALA MADHYA MAHARASHTRA
MANIPUR MEGHALAYA MIZORAM NAGALAND ODISHA ORISSA PUNJAB RAJASTHAN SIKKIM TAMIL NADU TELANGANA TRIPURA UTTAR UTTARAKHAND
WEST EAST NORTH SOUTH BENGAL DELHI JAMMU KASHMIR LADAKH LAKSHADWEEP PUDUCHERRY PONDICHERRY CHANDIGARH DADRA HAVELI DAMAN DIU
ANDAMAN NICOBAR ISLANDS INDIA INDIAN BENGALURU BANGALORE MYSURU MYSORE MUMBAI BOMBAY CHENNAI MADRAS HYDERABAD SECUNDERABAD
KOLKATA CALCUTTA PUNE AHMEDABAD SURAT JAIPUR LUCKNOW NOIDA GURUGRAM GURGAON HUBLI HUBBALLI DHARWAD MANGALURU MANGALORE
BELAGAVI BELGAUM KOCHI COCHIN COIMBATORE NAVI THANE NAGPUR INDORE BHOPAL PATNA RANCHI KANPUR VARANASI VADODARA BARODA NASHIK
VISAKHAPATNAM VIZAG VIJAYAWADA MADURAI TRICHY SALEM TUMAKURU TUMKUR SHIVAMOGGA DAVANGERE BALLARI KALABURAGI UDUPI HASSAN
INTERNATIONAL NATIONAL REGIONAL OVERSEAS DOMESTIC FOREIGN GOVERNMENT GOVT MINISTRY DEPARTMENT DEPT
STEEL IRON COPPER ALUMINIUM ALUMINUM BRASS ZINC METAL WIRE ROD PIPE SHEET PLATE BOLT NUT SCREW CEMENT SAND BRICK TILE PAINT
OIL GHEE RICE WHEAT SUGAR SALT TEA COFFEE MILK FLOUR ATTA DAL PULSES SPICES GRAINS GARMENT SHIRT TROUSERS SAREE FABRIC COTTON
SILK YARN THREAD PAPER CARTON BOX BAG BOTTLE CAN PLASTIC RUBBER GLASS WOOD WOODEN TIMBER PLYWOOD CHAIR DESK CABINET LAPTOP
COMPUTER DESKTOP MONITOR PRINTER TONER CARTRIDGE CHARGER CABLE BATTERY BATTERIES INVERTER UPS FAN LIGHT BULB TUBE LED LAMP
SWITCH SOCKET MOTOR PUMP VALVE BEARING GEAR SPARE PARTS TYRE ENGINE CAR BIKE TRUCK LUBRICANT GREASE MEDICINE TABLET CAPSULE
SYRUP INJECTION COSMETICS SOAP SHAMPOO DETERGENT CHEMICAL FERTILISER FERTILIZER SEEDS FEED FODDER DAIRY SWEETS SNACKS BAKERY
BEVERAGES JUICE WATER MILD GALVANISED GALVANIZED STAINLESS TMT HDPE PVC MS SS GI CI LCD HD HDMI USB SSD HDD RAM CPU GPU AC DC
AMC SIM HARDWARE PRODUCT MATERIAL CONSUMABLE CONSUMABLES ACCESSORY ACCESSORIES EQUIPMENT TOOL MACHINE INSTRUMENTS COMPONENT
ASSEMBLY KIT SET PACK ROLL COIL SCRAP CLEANING HOUSEKEEPING CATERING CANTEEN PANTRY HIRE HIRING ADVERTISING ADVERTISEMENT
PROMOTION BRANDING DESIGN DEVELOPMENT HOSTING DOMAIN CLOUD SUPPORT INSTALLATION COMMISSIONING SERVICING CALIBRATION TESTING
INSPECTION VALUATION SURVEY RECRUITMENT MANPOWER OUTSOURCING GUARD DRIVER LOADING UNLOADING HANDLING WAREHOUSING STORAGE
TRANSPORTATION CARRIAGE CARTAGE DELIVERY SHIPPING INSURANCE PREMIA POLICY MEDICLAIM GROUP HEALTH LIFE FIRE MARINE
OFFICE SHOP FACTORY GODOWN WAREHOUSE PREMISES SITE PROJECT HOSTEL GUEST RESIDENTIAL COMMERCIAL
FEE CONSULTANCY CONSULTATION ADVISORY RETAINERSHIP BOOKKEEPING TAXATION NOTARY ADMIN ADMINISTRATIVE GENERAL MISC SUNDRIES
ROUNDING EXCHANGE FOREX GAIN
ONBOARD ONBOARDING CREATE ADD SETUP SET OPEN UPDATE CHANGE REMOVE DELETE CLOSE SEND CALL MEET FOLLOW VERIFY CONFIRM PAY RECEIVE
COLLECT RAISE GENERATE DOWNLOAD UPLOAD SUBMIT PREPARE REMIND REMINDER ASK TELL INFORM NOTIFY GET GIVE MAKE TAKE USE NEED WANT
ENSURE KEEP HOLD REGARDING RE SUBJECT FWD FW CC BCC NEW EXAMPLE SAMPLE TEST DEMO DUMMY TEMPLATE
SENIOR ACCOUNTANT ACCOUNTANCY CHARTERED EXECUTIVE ASSOCIATE ANALYST OFFICER TRAINEE INTERN ARTICLE ARTICLED
CONSULTANT SUPERVISOR COORDINATOR CASHIER INCHARGE DEPUTY CHIEF PROCEDURE PROCESS SUBPROCESS STEP BRIEF CONFIRMED
CLARIFICATION AUTHOR PURPOSE RESPONSIBILITY DEFINITION CONTROL KPI FLOWCHART WORKFLOW FOLDER BANKING NETBANKING
GATEWAY SAVE PERFORM RECORD RECONCILE RESOLVE STORE PRINT SELECT ENTER CLICK NAVIGATE TICK SIGN LOGIN LOGOUT RENAME
ATTACH SCAN IDENTIFY INVESTIGATE CORRECT COMPARE COMPLETE OBTAIN ESCALATE ASSIGN TRACK VALIDATE FILL SEARCH
APPROVAL REMARK COMMENT SIGNATURE APPOINTMENT IDENTIFICATION COMMISSIONER COMMITTEE TENURE DESIGNATION RATING STIPEND COUNTER
AGREEMENT CONSENT
NAME SURNAME FULL MIDDLE CONTACT PERSON ATTN ATTENTION DEDUCTOR DEDUCTEE PAYEE PROPRIETOR PROPRIETRESS LANDLORD LANDLADY
TENANT LESSOR LESSEE SIGNATORY BENEFICIARY NOMINEE FATHER MOTHER SPOUSE HUSBAND WIFE GUARDIAN ASSESSEE TAXPAYER APPLICANT
SHAREHOLDER BORROWER GUARANTOR KARTA TRUSTEE SETTLOR REMITTER DRAWER DRAWEE PATIENT STUDENT
`;
// The last three lines: the label words of LABEL_SOURCE / ROLE. Were one masked as a "name", the label rule could
// not see the name after it ("⟨NAME_1⟩ of Employee: Asha" would go out with Asha in it). Label words that are also
// surnames stay out (Holder, Seller(s), Owner, Member, Given(s), Witness, Buyer, Payer, Lender, Sender).

// Job titles are business words (so "Senior Accountant" is never a name), but they also announce one, like an
// honorific: a labelled value skips them ("Employee: Senior Accountant Asha") and a role noun followed by name
// words marks those words ("Cashier Lakshmi", "Senior Accountant Kiran Kumar"). A modifier alone does not
// ("Chief Financial Officer"). Words that are also given names or surnames (Junior, Clerk, Banks) stay out.
const ROLE_NOUNS: ReadonlySet<string> = new Set([
  "ACCOUNTANT", "CASHIER", "INTERN", "TRAINEE", "EXECUTIVE", "ASSOCIATE", "ANALYST", "OFFICER", "CONSULTANT", "SUPERVISOR",
  "COORDINATOR", "INCHARGE", "ASSISTANT", "MANAGER", "REVIEWER", "PREPARER", "PARTNER", "DIRECTOR", "AUDITOR", "COMMISSIONER",
  // Person roles of a label ("Landlord Ravi"): business words too, so they are never a name themselves.
  "LANDLORD", "LANDLADY", "TENANT", "PROPRIETOR", "PROPRIETRESS", "KARTA", "PAYEE", "NOMINEE", "GUARDIAN", "TRUSTEE",
]);
/** Role words that may start a labelled value before the name ("Payee: Owner Ravi"); not business words (surnames). */
const LABEL_ROLES: ReadonlySet<string> = new Set(["OWNER", "HOLDER", "MEMBER", "WITNESS", "BUYER", "SELLER", "PAYER", "LENDER", "SENDER"]);
const JOB_TITLES: ReadonlySet<string> = new Set([...ROLE_NOUNS, "SENIOR", "CHIEF", "DEPUTY", "CHARTERED", "ARTICLE", "ARTICLED", "HEAD"]);

/** Every word of BUSINESS_TEXT plus the narration stopwords. Upper case. */
export const BUSINESS_WORDS: ReadonlySet<string> = new Set([...NAME_STOPWORDS, ...BUSINESS_TEXT.split(/\s+/).filter(Boolean)]);

/** Is this word (any case) a business / accounting / place / instruction word? Plurals fold to the singular. */
export function isBusinessWord(word: string): boolean {
  const u = (word.includes("'") || word.includes("’") ? word.replace(/['’]/g, "") : word).toUpperCase();
  if (!u || BUSINESS_WORDS.has(u)) return true;
  if (u.length > 3 && u.endsWith("S")) {
    if (BUSINESS_WORDS.has(u.slice(0, -1))) return true;
    if (u.endsWith("IES") && BUSINESS_WORDS.has(`${u.slice(0, -3)}Y`)) return true;
    if (u.endsWith("ES") && BUSINESS_WORDS.has(u.slice(0, -2))) return true;
  }
  return false;
}

export type PersonNameReason = "honorific" | "label" | "json" | "rail" | "sequence";
export type PersonNameSpan = NameSpan & { reason: PersonNameReason };

type WordClass = "title" | "caps" | "initial" | "lower";
type Tok = { s: number; e: number; w: string; cls: WordClass; glued: boolean; biz?: boolean; org?: boolean };

/** isBusinessWord / isOrgSuffix of a token, computed once. */
const tokBiz = (t: Tok) => (t.biz ??= isBusinessWord(t.w));
const tokOrg = (t: Tok) => (t.org ??= ORG_SUFFIX_WORDS.has(t.w.toUpperCase()));

const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isUpper = (c: number) => c >= 65 && c <= 90;
const isLower = (c: number) => c >= 97 && c <= 122;

/**
 * Title ("Rajesh", "D'Souza"), caps ("RAJESH"), initial ("R"), camel ("RajeshKumar": 2–4 Title
 * parts), else lower. Character tests, no regular expressions (this runs once per word).
 */
function classify(text: string, s: number, e: number): WordClass | "camel" {
  const first = text.charCodeAt(s);
  if (e - s === 1) return isUpper(first) ? "initial" : "lower";
  if (!isUpper(first)) return "lower";
  let lower = 0;
  let upper = 1;
  let humps = 0;
  let apostrophe = false;
  for (let i = s + 1; i < e; i++) {
    const c = text.charCodeAt(i);
    if (isLower(c)) lower++;
    else if (isUpper(c)) {
      upper++;
      if (lower > 0 && !apostrophe && isLower(text.charCodeAt(i - 1))) humps++;
    } else apostrophe = true;
  }
  if (lower === 0) return "caps";
  if (upper === 1 || (apostrophe && humps === 0)) return "title";
  return humps >= 1 && humps <= 3 && upper === humps + 1 && !apostrophe && e - s <= 40 ? "camel" : "lower";
}

/**
 * Words of `text` (ASCII letters with internal apostrophes), skipping ⟨…⟩ placeholders; a camelCase
 * word is split into its parts ("RajeshKumarSharma" → Rajesh Kumar Sharma, glued).
 */
function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const n = text.length;
  for (let i = 0; i < n; ) {
    const c = text.charCodeAt(i);
    if (c === 0x27e8) {
      const close = text.indexOf("⟩", i);
      i = close > i && close - i <= 66 ? close + 1 : i + 1;
      continue;
    }
    if (!isAsciiLetter(c)) {
      i++;
      continue;
    }
    const s = i;
    while (i < n) {
      const d = text.charCodeAt(i);
      if (isAsciiLetter(d) || ((d === 0x27 || d === 0x2019) && i + 1 < n && isAsciiLetter(text.charCodeAt(i + 1)))) i++;
      else break;
    }
    // A word glued to digits ("GSTR-3B", "Form16", "FY2526", "12mm") is a code, never part of a name.
    const before = s > 0 ? text.charCodeAt(s - 1) : 0;
    const after = i < n ? text.charCodeAt(i) : 0;
    const cls = (before >= 48 && before <= 57) || (after >= 48 && after <= 57) ? "lower" : classify(text, s, i);
    if (cls === "camel") {
      // RajeshKumarSharma → Rajesh | Kumar | Sharma (glued to each other).
      let p = s;
      for (let q = s + 1; q <= i; q++) {
        if (q === i || isUpper(text.charCodeAt(q))) {
          out.push({ s: p, e: q, w: text.slice(p, q), cls: "title", glued: p > s });
          p = q;
        }
      }
    } else out.push({ s, e: i, w: text.slice(s, i), cls, glued: false });
  }
  return out;
}

const HONORIFIC_TITLE: ReadonlySet<string> = new Set(["Mr", "Mrs", "Ms", "Dr", "Shri", "Smt", "Sri", "Kum", "Kumari", "Miss", "Prof", "Sh", "Shrimati", "Selvi", "Thiru", "Tmt"]);
const HONORIFIC_CAPS: ReadonlySet<string> = new Set(["SHRI", "SMT", "SRI", "KUMARI", "SHRIMATI", "SELVI", "THIRU", "TMT"]);
const HONORIFIC_CAPS_DOT: ReadonlySet<string> = new Set(["MR", "MRS", "MS", "DR", "PROF", "KUM", "SH"]);

/** Is token k an honorific (with the dot rule for the ambiguous all-capitals forms "MS", "DR")? */
function isHonorificAt(text: string, toks: Tok[], k: number): boolean {
  const t = toks[k];
  if (t.glued) return false;
  if (HONORIFIC_TITLE.has(t.w) || HONORIFIC_CAPS.has(t.w)) return true;
  return HONORIFIC_CAPS_DOT.has(t.w) && text.charCodeAt(t.e) === 0x2e;
}

/** May toks[k] continue the name that toks[k-1] is part of? (one or two spaces, "_", or "." after an initial / honorific). */
function joinable(text: string, toks: Tok[], k: number): boolean {
  const a = toks[k - 1];
  const b = toks[k];
  if (b.glued) return true;
  const len = b.s - a.e;
  if (len < 1 || len > 2) return false;
  const g0 = text.charCodeAt(a.e);
  const g1 = len === 2 ? text.charCodeAt(a.e + 1) : -1;
  if (len === 1 && (g0 === 0x20 || g0 === 0x5f || g0 === 0xa0)) return true; // " ", "_", NBSP
  if (g0 === 0x20 && g1 === 0x20) return true; // two spaces
  return g0 === 0x2e && (len === 1 || g1 === 0x20) && (a.cls === "initial" || isHonorificAt(text, toks, k - 1)); // "." / ". " after R. or Mr.
}

/** A capitalised job title ("Senior", "Accountant"); see JOB_TITLES. */
const jobTitle = (t: Tok, set: ReadonlySet<string> = JOB_TITLES) => !t.glued && (t.cls === "title" || t.cls === "caps") && set.has(t.w.toUpperCase());

/** A capitalised word that can be part of a name (an organisation suffix counts; business words do not). */
const nameWord = (t: Tok) => (t.cls === "title" || t.cls === "caps" || t.cls === "initial") && (tokOrg(t) || !tokBiz(t));
/** A core name word: not an initial, not a two-letter all-capitals code ("KA", "MS"), not an organisation suffix. */
const coreWord = (t: Tok) => t.cls !== "initial" && !(t.cls === "caps" && t.w.length < 3) && !tokOrg(t);

/** The span of toks[i..j] if it reads as a name: ≥ minCore core words (or one core word with an initial), or ≥1 core word + an organisation suffix. */
function runSpan(toks: Tok[], i: number, j: number, reason: PersonNameReason, minCore: number): PersonNameSpan | null {
  let core = 0;
  let weak = 0;
  let suffix = false;
  let long = false;
  for (let k = i; k <= j; k++) {
    const t = toks[k];
    if (t.cls !== "initial" && tokOrg(t)) {
      if (core > 0) suffix = true;
      continue;
    }
    if (coreWord(t)) {
      core++;
      if (t.w.length >= 3) long = true;
    } else if (t.cls === "initial") weak++;
  }
  if (suffix) return { start: toks[i].s, end: toks[j].e, kind: "ORG", reason };
  if (!long) return null;
  if (reason === "sequence" && core > 4) return null; // a long capitalised run is a heading, not a name
  if (core >= minCore || (core >= 1 && weak >= 1)) return { start: toks[i].s, end: toks[j].e, kind: "NAME", reason };
  return null;
}

/** Runs of name words in toks[from..to] (joined), each turned into a span with runSpan. */
function runsIn(text: string, toks: Tok[], from: number, to: number, reason: PersonNameReason, minCore: number, out: PersonNameSpan[], accept: (t: Tok) => boolean = nameWord) {
  let k = from;
  while (k <= to) {
    if (!accept(toks[k]) || isHonorificAt(text, toks, k)) {
      k++;
      continue;
    }
    let j = k;
    while (j + 1 <= to && accept(toks[j + 1]) && !isHonorificAt(text, toks, j + 1) && joinable(text, toks, j + 1)) j++;
    const span = runSpan(toks, k, j, reason, minCore);
    if (span) out.push(span);
    k = j + 1;
  }
}

/** First token index with s >= pos (binary search). */
function tokenAt(toks: Tok[], pos: number): number {
  let lo = 0;
  let hi = toks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toks[mid].s < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Roles whose value is a person (or a party): "employee:", "Name of the Landlord:", "Payee name:". */
const ROLE =
  "(?:employee|employer|deductor|deductee|payee|payer|director|proprietor|proprietress|partner|landlord|landlady|tenant|owner|lessor|lessee|" +
  "contact(?:\\s+person)?|customer|supplier|vendor|buyer|seller|(?:authori[sz]ed\\s+)?signatory|beneficiary|nominee|(?:account\\s+|a\\/c\\s+)?holder|" +
  "father|mother|spouse|husband|wife|guardian|assessee|taxpayer|applicant|shareholder|member|auditor|consultant|borrower|lender|guarantor|" +
  "witness|individual|person|karta|trustee|settlor|accountant|client|party|recipient|sender|remitter|drawer|drawee|patient|student)";
const LABEL_SOURCE =
  `(?:name\\s+of\\s+(?:the\\s+)?${ROLE}|${ROLE}(?:['’]s)?(?:\\s+(?:full\\s+)?name)?|(?:full|first|last|middle|given|sur|party|person|contact|beneficiary|holder)\\s*name|surname|name|` +
  "attn|attention|c\\/o|s\\/o|d\\/o|w\\/o|son\\s+of|daughter\\s+of|wife\\s+of|husband\\s+of)";
/** `label :` at the start of the text, a line or a cell. */
const LABEL_RE = new RegExp(`(?:^|(?<=[\\n\\r|;\\t{,(]))[ \\t"'*-]{0,4}${LABEL_SOURCE}[ \\t"']{0,3}[:=][ \\t"']{0,3}`, "gi");
/** Where a labelled value ends. */
const VALUE_END = /[\n\r|;\t,"(){}[\]<>]| {2}/g;
const VALUE_MAX = 80;

/** JSON keys whose string value is a person or organisation name. */
export const NAME_KEYS: ReadonlySet<string> = new Set([
  "fullname", "personname", "partyname", "party", "payee", "payer", "employee", "employeename", "employer", "employername", "deductor",
  "deductorname", "deductee", "deducteename", "director", "directorname", "proprietor", "proprietorname", "partner", "partnername",
  "contact", "contactname", "contactperson", "customer", "customername", "supplier", "suppliername", "vendor", "vendorname", "buyer",
  "seller", "tenant", "landlord", "signatory", "beneficiary", "nominee", "holder", "accountholder", "relatedparty", "counterparty",
  "tradename", "legalname", "father", "fathername", "mother", "mothername", "spouse", "spousename", "guardian", "taxpayer", "assessee",
]);
/** The anonymizer's claimed-span fills (U+E000 / U+E001) end a value like a quote does. */
const FILLS = String.fromCharCode(0xe000, 0xe001);
const JSON_NAME_RE = new RegExp(`"([A-Za-z][A-Za-z_-]{1,39})"\\s{0,3}:\\s{0,3}"([^"\\\\\\n${FILLS}]{1,160})"`, "g");

/** A labelled / keyed value: the name words in it (any case), or nothing for a business value ("Cash", "Rent"). */
function valueSpans(text: string, toks: Tok[], start: number, end: number, reason: PersonNameReason, out: PersonNameSpan[]) {
  const from = tokenAt(toks, start);
  let to = from - 1;
  while (to + 1 < toks.length && toks[to + 1].e <= end) to++;
  if (to < from) return;
  let first = from;
  while (first <= to && isHonorificAt(text, toks, first)) first++;
  // "Name: Executive Enterprises": a firm whose name starts with a job title keeps it.
  if (first <= to && jobTitle(toks[first])) {
    let last = -1;
    for (let k = first + 1; k <= to && toks[k].s - toks[k - 1].e <= 3; k++) if (toks[k].cls !== "lower" && toks[k].cls !== "initial" && tokOrg(toks[k])) last = k;
    if (last > first) {
      out.push({ start: toks[first].s, end: toks[last].e, kind: "ORG", reason });
      first = last + 1;
      if (first > to) return;
    }
  }
  // Skip a leading job title or role word, but never the value's last word ("Payee: Owner" may be a surname).
  while (first < to && (jobTitle(toks[first]) || jobTitle(toks[first], LABEL_ROLES))) first++;
  // A value is a name only when its first word is not a business word (Name of Ledger: "Rent", payee: "Cash").
  if (first > to || tokBiz(toks[first])) return;
  // A firm's name keeps its business words: "Name: Synthetic Client Pvt Ltd" is one organisation.
  let suffix = -1;
  for (let k = first + 1; k <= to && toks[k].s - toks[k - 1].e <= 3; k++) if (toks[k].cls !== "lower" && toks[k].cls !== "initial" && tokOrg(toks[k])) suffix = k;
  if (suffix > first) {
    out.push({ start: toks[first].s, end: toks[suffix].e, kind: "ORG", reason });
    first = suffix + 1;
    if (first > to) return;
  }
  // An all-lower-case value ("employee: rajesh kumar") is read in any case; otherwise capitalised words only.
  runsIn(text, toks, first, to, reason, 1, out, toks[first].cls === "lower" ? valueWordAnyCase : valueWord);
}

/** A word of a labelled value: not a business word (an organisation suffix counts). */
const valueWordAnyCase = (t: Tok) => tokOrg(t) || !tokBiz(t);
const valueWord = (t: Tok) => t.cls !== "lower" && valueWordAnyCase(t);
/** After M/s every capitalised word is the firm's name ("M/s Sunrise Steel"). */
const firmWord = (t: Tok) => t.cls === "title" || t.cls === "caps" || t.cls === "initial";

function labelSpans(text: string, toks: Tok[], out: PersonNameSpan[]) {
  LABEL_RE.lastIndex = 0;
  for (let m = LABEL_RE.exec(text); m; m = LABEL_RE.exec(text)) {
    if (m[0].length === 0) {
      LABEL_RE.lastIndex++;
      continue;
    }
    const start = m.index + m[0].length;
    VALUE_END.lastIndex = start;
    const stop = VALUE_END.exec(text);
    const end = Math.min(stop && stop.index - start <= VALUE_MAX ? stop.index : start + VALUE_MAX, text.length);
    valueSpans(text, toks, start, end, "label", out);
  }
}

function jsonSpans(text: string, toks: Tok[], out: PersonNameSpan[]) {
  JSON_NAME_RE.lastIndex = 0;
  for (let m = JSON_NAME_RE.exec(text); m; m = JSON_NAME_RE.exec(text)) {
    if (!NAME_KEYS.has(m[1].toLowerCase().replace(/[_-]/g, ""))) continue;
    const end = m.index + m[0].length - 1;
    valueSpans(text, toks, end - m[2].length, end, "json", out);
  }
}

function honorificSpans(text: string, toks: Tok[], out: PersonNameSpan[]) {
  for (let k = 0; k + 1 < toks.length; k++) {
    // "M/s Sunrise Steel": a firm.
    const firm = (toks[k].w === "M" || toks[k].w === "m") && /^\/[sS]\.?\s/.test(text.slice(toks[k].e, toks[k].e + 4));
    // A role noun works like an honorific when a name word follows it: "Cashier Lakshmi".
    const role = !firm && jobTitle(toks[k], ROLE_NOUNS) && !jobTitle(toks[k + 1]);
    if (!firm && !role && !isHonorificAt(text, toks, k)) continue;
    let first = k + 1;
    if (firm) {
      first = k + 2; // skip the "s" of M/s
      if (first >= toks.length || toks[first].s - toks[k].e > 6) continue;
    } else if (!joinable(text, toks, first)) continue;
    // After M/s every capitalised word is the firm's name; after a personal honorific, name words only.
    const word = firm ? firmWord : nameWord;
    let j = first - 1;
    while (j + 1 < toks.length && j + 1 - first < 4 && word(toks[j + 1]) && !isHonorificAt(text, toks, j + 1) && (j + 1 === first || joinable(text, toks, j + 1))) j++;
    if (j < first) continue;
    const span = runSpan(toks, first, j, "honorific", 1);
    if (span) out.push(firm ? { ...span, kind: "ORG" } : span);
    // A role noun that found no name must not swallow what follows ("Landlord M/s Sunrise Steel").
    if (span || !role) k = j;
  }
}

/**
 * A job title can start a firm's name: "Executive Enterprises", "Deputy Traders Pvt Ltd". Only titles and
 * organisation suffixes may follow it (a firm with a person's name in it, "Manager Kiran Rao Traders", is left to
 * the sequence rule), and the suffix must not lead into another title ("Chief Financial Officer" is a job, though
 * FINANCIAL is a suffix).
 */
function titleFirmSpans(text: string, toks: Tok[], out: PersonNameSpan[]) {
  for (let k = 0; k + 1 < toks.length; k++) {
    if (!jobTitle(toks[k])) continue;
    let last = -1;
    for (let j = k + 1; j < toks.length && j - k <= 4 && (toks[j].cls === "title" || toks[j].cls === "caps") && joinable(text, toks, j); j++) {
      if (tokOrg(toks[j])) last = j;
      else if (!jobTitle(toks[j])) break;
    }
    if (last < 0 || (last + 1 < toks.length && jobTitle(toks[last + 1]) && joinable(text, toks, last + 1))) continue;
    out.push({ start: toks[k].s, end: toks[last].e, kind: "ORG", reason: "sequence" });
    k = last;
  }
}

const UPI_RE = new RegExp(`(?<![A-Za-z0-9])UPI[/-](?:[A-Z0-9]{2,4}[/-])?\\d{6,}[/-]([^/\\n\\r|${FILLS}⟨]{2,60})`, "gi");
const RAIL_SEG_RE =/(?<![A-Za-z0-9])(?:NEFT|IMPS|RTGS)[-/:]/gi;
const IFSC_LIKE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
/** - / : newline | , ; and the anonymizer's claimed-span fills end a narration segment. */
const SEG_BREAK_CODES = new Set([0x2d, 0x2f, 0x3a, 0x0a, 0x0d, 0x7c, 0x2c, 0x3b, 0xe000, 0xe001, 0x27e8]);
const SEG_CONTINUE_CODES = new Set([0x2d, 0x2f, 0x3a]);
/** A payment-rail word inside a segment: the next narration starts there (it gets its own scan, which keeps this linear). */
const RAIL_WORD_IN = /(?<![A-Za-z])(?:NEFT|IMPS|RTGS|UPI)(?![A-Za-z])/i;

function railSpans(text: string, toks: Tok[], out: PersonNameSpan[]) {
  UPI_RE.lastIndex = 0;
  for (let m = UPI_RE.exec(text); m; m = UPI_RE.exec(text)) {
    const end = m.index + m[0].length;
    valueSpans(text, toks, end - m[1].length, end, "rail", out);
  }
  // NEFT-RAJESH-SAL OCT: the first segment of letters that is not a code, a bank or a business word is the payee.
  RAIL_SEG_RE.lastIndex = 0;
  for (let m = RAIL_SEG_RE.exec(text); m; m = RAIL_SEG_RE.exec(text)) {
    let i = m.index + m[0].length;
    const limit = Math.min(text.length, i + 120);
    for (let seg = 0; seg < 6 && i < limit; seg++) {
      let j = i;
      while (j < limit && !SEG_BREAK_CODES.has(text.charCodeAt(j))) j++;
      const raw = text.slice(i, j).trim();
      if (RAIL_WORD_IN.test(raw)) break;
      if (raw && /^[A-Za-z][A-Za-z .'’]*$/.test(raw) && !IFSC_LIKE.test(raw)) {
        const words = raw.split(/[\s.]+/).filter(Boolean);
        if (!isBusinessWord(words[0]) && words.some((w) => w.length >= 3 && !isBusinessWord(w))) {
          valueSpans(text, toks, i, j, "rail", out);
          break;
        }
      }
      if (j >= limit || !SEG_CONTINUE_CODES.has(text.charCodeAt(j))) break;
      i = j + 1;
    }
  }
  for (const s of narrationNameSpans(text)) out.push({ ...s, reason: "rail" });
}

/** Any payment-rail keyword (the narration rules have nothing to do without one). */
const RAIL_PRESENT = new RegExp(`(?<![A-Za-z0-9])(?:${RAILS})(?![A-Za-z0-9])`, "i");

/** Probable person (and firm) names in free text, by the five rules above. Spans index `text`; overlaps resolved longest-first. */
export function personNameSpans(text: string): PersonNameSpan[] {
  if (!text) return [];
  const toks = tokenize(text);
  if (!toks.length) return [];
  const found: PersonNameSpan[] = [];
  // Each rule runs only when its marker can be in the text (cheap tests keep long inputs fast).
  if (text.includes('"')) jsonSpans(text, toks, found);
  if (text.includes(":") || text.includes("=")) labelSpans(text, toks, found);
  honorificSpans(text, toks, found);
  titleFirmSpans(text, toks, found);
  if (RAIL_PRESENT.test(text)) railSpans(text, toks, found);
  runsIn(text, toks, 0, toks.length - 1, "sequence", 2, found);
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: PersonNameSpan[] = [];
  let lastEnd = -1;
  for (const s of found) {
    if (s.end <= s.start || s.start < lastEnd) continue;
    out.push(s);
    lastEnd = s.end;
  }
  return out;
}

/** The names personNameSpans finds, as dictionary entries. */
export function personNames(text: string | null | undefined): DictionaryEntry[] {
  if (!text) return [];
  const out: DictionaryEntry[] = [];
  for (const s of personNameSpans(text)) {
    const value = text.slice(s.start, s.end).replace(/[_\s]+/g, " ").trim();
    if (value.replace(/[^A-Za-z]/g, "").length >= 3) out.push({ value, kind: s.kind });
  }
  return out;
}

/** personNames over several free-text values (descriptions, ledgers, notes, narrations, file names). */
export function freeTextNames(values: Iterable<string | null | undefined>): DictionaryEntry[] {
  const out: DictionaryEntry[] = [];
  for (const v of values) if (v) out.push(...personNames(v.length > 200_000 ? v.slice(0, 200_000) : v));
  return out;
}

/** A file name as words ("Form16_RAJESH_KUMAR_SHARMA_FY2526.pdf" → "Form16 RAJESH KUMAR SHARMA FY2526"), for personNames. */
export function fileNameText(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_.\-+]+/g, " ");
}

# Engagement Letter (EL) Generator

A single HTML file used internally at Indefine. You fill in the form on the left, the letter appears on the right, and you export it as a **PDF** (on the letterhead, which repeats on every page) or as a **Word .doc** for last-minute edits. It has no server and no login, and nothing typed into it leaves the browser.

Built 28 Sep 2026 from the reference letter *Deepa – Srikrish Traders FY 24-25*.

> **In the LMS:** Tools → Document & Tax Tools → *Engagement Letter* (`/tools/office-tools/engagement-letter`, internal-active users only). The route `src/app/tools/office-tools/engagement-letter/route.ts` inlines the letterhead into `src/lib/office-tools/engagement-letter/el-generator.template.html` on each request, so there is no `build.sh` step here: edit the template (PARTNERS, TYPES, ANNEXURE) and deploy. Runs fully in the browser, so no audit row is written.

---

## 1. Files

| File | What it is |
|---|---|
| `el-generator.html` | **The tool.** One self-contained file with the letterhead embedded. Share it on Drive or WhatsApp and open it in Chrome or Edge. |
| `el-generator.template.html` | The source. Edit this file, not the built one. |
| `letterhead-header.jpg`, `letterhead-footer.jpg` | Letterhead images taken from the reference PDF. The footer address was updated on 28 Sep 2026 to *Ranka Junction, 2nd floor, Near Tin factory, Bangalore-560043*. |
| `build.sh` | Embeds the two images into the template to produce `el-generator.html`. Run it after every edit. |
| `sample-srikrish.pdf` | Sample output: 7 pages, filled with the Srikrish Traders data. |

## 2. How to use

1. Open `el-generator.html` in **Chrome or Edge**.
2. Pick the **letter type** first. This pre-fills the subject, services, exclusions, frequency and billing.
3. Fill in the client, client signatory, term, fees and Indefine partner. Required fields show a red border until they are filled.
4. Optionally attach the partner's **signature image**. It is used only in this browser tab and is never saved in any file.
5. **Print / Save as PDF**: choose "Save as PDF" and **turn off "Headers and footers"** in the print dialog. The file name is set automatically to `EL_<Client>_FY<yy-yy>`.
6. **Download Word (.doc)**: opens in Word, ready for edits.
7. **Save form (.json)**: keep this with the client file. Next year, **Load form**, change the dates and fee, and print.

The client signs by hand. Indefine's stamp is applied physically; there is room beside the signature for it.

## 3. Fields

| # | Requested field | Where it appears |
|---|---|---|
| 1 | Client name | To-block, acceptance page |
| 2 | Start date of services | "effective from 1st April 2026"; end date is calculated as start + term − 1 day |
| 3 | Yearly increment % | "The fee shall be revised by 10% on each anniversary…" (0% drops the sentence) |
| 4 | Auto-renewal | Checkbox. On: renews for 12-month periods unless notice is given 45 days before expiry. Off: expires on the end date |
| 5 | Services provided | Textarea, one per line, printed as a, b, c… Leading "a.", "-" and "•" are stripped, so a Turia list can be pasted in as it is |
| 6 | Amount | "Rs 13,500/- per month (Rupees Thirteen Thousand Five Hundred only)" in Indian numbering; frequency is per month, per annum or one-time |
| 7 | Payment terms | 7 / 15 / 30 days of invoice date, plus 2% per month interest on delay |
| 8–10 | Address, email, contact no. | To-block |
| 11 | Services not in scope | Textarea, one per line |
| 12–13 | Signatory details, contact no., email | Acceptance block (client) |
| extra | Letter date, ref no., subject, salutation, billing, initial term, Indefine partner, signature | |

**Indefine signatory** is typed in (name, designation, phone, email). Names used for a print or Word download are remembered in that browser and offered in the Name dropdown; picking one fills the rest. To offer a partner to everyone, add them to `PARTNERS` at the top of the `<script>` in the template.
**To change the default wording of the three letter types**, edit `TYPES` / `COMMON_EXCLUSIONS` in the same place.

## 4. Annexure review: what was wrong, what was fixed, what was added

All three letter types share one annexure. **Items marked NEW are my additions. Strike any you do not want** (they are plain `<h3>`/`<p>` blocks in `ANNEXURE`).

### Errors in the old annexure (fixed)

| # | Issue | Why it matters |
|---|---|---|
| 1 | **"We will normally seek to verify or check any information"** (Our commitment) | The word "not" is missing, so the clause means the opposite of what was intended. As written, Indefine **promised to verify** client data. Now reads "We will **not** normally seek to verify". |
| 2 | **"We will except to such extent as you request… seek to verify"** (Limitation of scope) | Same missing "not". It also contradicts the next sentence ("you are solely responsible"). Fixed. |
| 3 | **"SCRA" appears twice** (Limitation of liability, Conflict of interest) | Another firm's name, left over from a copied template. Replaced with Indefine. |
| 4 | **Indemnity: "costs… incurred by Client"** | The client was indemnifying *itself*. Now reads "incurred by Indefine". |
| 5 | **Contracting party never defined** | "Indefine" is a brand. The annexure now opens by defining Indefine as a unit of Streamlining Workflows Consultancy Private Limited, and defines the Client. The sign-off and acceptance use the same wording. |
| 6 | "between Indefine and **the firm**" (Entire agreement) | Now reads "and the Client". |
| 7 | "its **Partners**" | The contracting party is a company, so this now reads "directors, partners and employees". |
| 8 | Hold-harmless clause had no carve-out | Added "except gross negligence or wilful misconduct", matching the indemnity. An unlimited hold-harmless is less likely to be upheld. |
| 9 | Typos: "obligationsascribed", "mayarise", "whichmay", "respectof"; "Bangalore" → "Bengaluru" | Fixed. |

### Errors in the old letter body (fixed)

- The internal note **"(General points mentioned below to be changed to be modified based on client)"** was sent to the client. It's gone.
- "The above fee is exclusive of GST" was listed as a *fee exclusion*. It now sits in the fee sentence.
- "until a period notified by either of the parties" was open-ended. It's replaced by a fixed term, auto-renewal and 45 days' notice.
- "before 5th of every month" and "annual increase… based on volume, complexity" are replaced by your 7/15/30-day and increment % fields.
- The letterhead differed between pages 1 and 2. Only the "A unit of Streamlining workflows consultancy Private Limited" header is used now.

### NEW clauses added (please review)

| Clause | What it says | Why |
|---|---|---|
| **Your commitment** (extended) | Indefine communicates cut-off dates; interest, late fees and penalties caused by late data, incomplete data or unpaid taxes are the client's | This is the most common dispute in a compliance retainer |
| **Access to portals and credentials** | Credentials used only for the engagement; the client approves filings and OTPs and changes passwords at the end | We hold GST, IT, MCA, EPFO and ESIC logins |
| **Personal data** | Indefine processes employee data only on the client's instructions, with reasonable safeguards; the client confirms notice and consent under the **DPDP Act, 2023** | Payroll means PAN, Aadhaar and bank details |
| **Fees, expenses and suspension** | Government fees and penalties are reimbursed at actuals; work may be suspended if an invoice is **30 days** overdue, with no liability for defaults during suspension | Without this, non-paying clients can still hold us to filing deadlines |
| **Liability cap** | Aggregate liability capped at fees paid for that service in the preceding 12 months | The old clause limited the *type* of damages but set no amount |
| **Non-solicitation** | No hiring of our staff for 12 months after the engagement ends | Standard for bookkeeping teams |
| **Termination** (extended) | Immediate termination for material breach not remedied in 15 days; records handed over once dues are settled; we retain our working papers | Termination on non-payment and handover of records were not covered |
| **Acceptance and notices** | A scanned or e-signed copy counts as the original; notices go to the addresses and emails in the letter | Most clients return a scan |

### For you to decide (not changed)

1. **Tax audit and other attest work.** The old letter listed "Tax Audit under IT Act" in scope. Indefine contracts as a **private limited company**. Tax audits, statutory audits and certifications must be signed by a practising CA or CA firm, so they cannot sit in a company's engagement letter. I removed tax audit from the default scope and added *"Statutory audit, tax audit, certifications and any other attest function"* to the exclusions. If Indefine's partners do these through their own CA firm, that needs a **separate engagement letter from the CA firm**. Please confirm this with your CA or legal adviser.
2. **Confidentiality lasts only 12 months** after the engagement ends. Client financial data usually warrants 3 years or longer. The 12 months is kept for now; change the number if you agree.
3. **Stamp duty.** A countersigned engagement letter is an agreement. Check with your adviser whether Karnataka stamp duty applies and at what amount. I have not added a figure.
4. **Old statute references.** From 1 April 2026 the Income-tax Act, 2025 applies, so avoid "IT Act" wording that implies the 1961 Act. The default services say "income-tax return", which avoids the issue.
5. The default services for **Annual compliance** and **Virtual CFO** are my drafts. Correct them in `TYPES`.

## 5. Verification done

- **Self-check:** open `el-generator.html#test` and the tab title reads `SELF-CHECK PASSED`. It covers amount-in-words (up to crores), end dates (including 31 Jan and leap years), ordinal dates, FY labels and cleaning of pasted lists. Passed in headless Chrome.
- **PDF:** a 7-page A4 PDF was printed in Chrome with the Srikrish data. The letterhead header and footer repeat on every page, and the acceptance page and annexure each start on a new page (`sample-srikrish.pdf`).
- **Word:** the downloaded `.doc` opens in Microsoft Word for Mac as 6 pages with both letterhead images and correct page breaks.

**Known limits**
- In the .doc, the letterhead sits at the top of page 1 and the bottom of the last page, not in Word's repeating header and footer. If you need it on every page in Word, cut and paste it into Word's header and footer.
- Printing is tested on Chrome and Edge. Safari may not repeat the letterhead.

## 6. Code

### `build.sh`

```sh
#!/bin/sh
# Embeds the two letterhead images into the template -> el-generator.html (the one file you share).
cd "$(dirname "$0")"
H=$(base64 < letterhead-header.jpg | tr -d '\n'); F=$(base64 < letterhead-footer.jpg | tr -d '\n')
sed -e "s|__HEAD__|data:image/jpeg;base64,$H|" -e "s|__FOOT__|data:image/jpeg;base64,$F|" el-generator.template.html > el-generator.html
echo "built el-generator.html"
```

### `el-generator.template.html`

The `__HEAD__` and `__FOOT__` placeholders are replaced with the letterhead images by `build.sh`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engagement Letter Generator</title>
<style>
  :root { --navy:#0B1D33; --gold:#C1974E; --paper:#F7F5F0; --slate:#5C6673; --line:#d9d4c7; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:#0E1726; font:14px/1.4 Inter, Arial, sans-serif; }
  .app { display:grid; grid-template-columns: 420px 1fr; gap:24px; padding:20px; align-items:start; }
  form { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; position:sticky; top:20px; max-height:calc(100vh - 40px); overflow:auto; }
  h1 { font-size:18px; margin:0 0 4px; color:var(--navy); }
  fieldset { border:0; border-top:1px solid var(--line); margin:14px 0 0; padding:10px 0 0; }
  legend { font-weight:600; color:var(--navy); padding-right:6px; }
  label { display:block; margin:8px 0 2px; font-size:12px; color:var(--slate); }
  label.inline { display:flex; gap:6px; align-items:center; color:#0E1726; font-size:13px; }
  input, select, textarea { width:100%; font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:4px; }
  input[type=checkbox] { width:auto; }
  textarea { resize:vertical; }
  input:invalid, textarea:invalid, select:invalid { border-color:#c0392b; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .hint { font-size:11px; color:var(--slate); }
  .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:16px; position:sticky; bottom:-16px; background:#fff; padding:10px 0; }
  button { font:inherit; padding:8px; border-radius:4px; border:1px solid var(--navy); background:#fff; color:var(--navy); cursor:pointer; }
  button.primary { background:var(--navy); color:#fff; }

  /* The letter: same markup on screen, in print and in the .doc */
  #sheet { background:#fff; width:210mm; margin:0 auto; padding:10mm 18mm; box-shadow:0 1px 6px rgba(0,0,0,.15); }
  .lh-head, .lh-foot { width:100%; display:block; }
  .pg { width:100%; border-collapse:collapse; }
  .pg td { padding:0; }
  .sp-h, .sp-f { height:6mm; }
  .letter { font-family:Calibri, Carlito, Arial, sans-serif; font-size:11pt; line-height:1.35; text-align:justify; }
  .letter h2 { font-size:12pt; text-align:center; margin:0 0 10pt; }
  .letter h3 { font-size:11pt; text-decoration:underline; margin:12pt 0 4pt; break-after:avoid; }
  .letter p { margin:0 0 8pt; }
  .letter ol, .letter ul { margin:0 0 8pt; padding-left:24pt; }
  .letter .right { text-align:right; }
  .letter .l { text-align:left; }   /* Word stretches justified lines that end in <br> */
  .letter .pb { break-before:page; page-break-before:always; }
  .letter .sig { height:48px; display:block; margin:6pt 0 2pt; }
  .letter .keep { break-inside:avoid; }
  .letter .blank { display:inline-block; min-width:180px; border-bottom:1px solid #000; }

  @media (max-width: 1100px) { .app { grid-template-columns:1fr; } form { position:static; max-height:none; } #sheet { width:100%; } }

  @page { size:A4; margin:10mm 18mm; }
  @media print {
    body { background:#fff; }
    form { display:none; }
    .app { display:block; padding:0; }
    #sheet { width:auto; margin:0; padding:0; box-shadow:none; }
    /* Fixed elements repeat on every printed page; the thead/tfoot spacers keep text clear of them. */
    .lh-head { position:fixed; top:0; left:0; }
    .lh-foot { position:fixed; bottom:0; left:0; }
    .sp-h { height:28mm; }
    .sp-f { height:28mm; }
  }
</style>
</head>
<body>
<div class="app">
<form id="f" autocomplete="off">
  <h1>Engagement letter generator</h1>
  <div class="hint">Nothing typed here leaves this browser. Use Chrome or Edge to print.</div>

  <fieldset><legend>Letter</legend>
    <label>Letter type (choose first)</label>
    <select name="type"></select>
    <div class="row">
      <div><label>Letter date</label><input type="date" name="letterDate" required></div>
      <div><label>Reference no.</label><input name="ref" placeholder="IDF/EL/2026-27/001"></div>
    </div>
    <label>Subject</label><input name="subject" required>
  </fieldset>

  <fieldset><legend>Client</legend>
    <label>Client name</label><input name="client" required>
    <label>Address</label><textarea name="address" rows="4" required></textarea>
    <div class="row">
      <div><label>Email ID</label><input type="email" name="email"></div>
      <div><label>Contact number</label><input type="tel" name="phone"></div>
    </div>
  </fieldset>

  <fieldset><legend>Client signatory</legend>
    <div class="row">
      <div><label>Name</label><input name="sigName" required></div>
      <div><label>Designation</label><input name="sigDesig" placeholder="Director / Proprietor"></div>
    </div>
    <div class="row">
      <div><label>Email ID</label><input type="email" name="sigEmail"></div>
      <div><label>Contact number</label><input type="tel" name="sigPhone"></div>
    </div>
    <label>Salutation ("Dear …")</label><input name="salutation" placeholder="Defaults to the signatory's first name">
  </fieldset>

  <fieldset><legend>Term</legend>
    <div class="row">
      <div><label>Start date of services</label><input type="date" name="start" required></div>
      <div><label>Initial term (months)</label><input type="number" name="term" min="1" value="12" required></div>
    </div>
    <label class="inline"><input type="checkbox" name="autorenew" checked> Auto-renew on expiry unless either party gives notice</label>
  </fieldset>

  <fieldset><legend>Scope</legend>
    <label>Services provided (one per line; a Turia list can be pasted here)</label>
    <textarea name="services" rows="8" required></textarea>
    <label>Services not included in scope (one per line)</label>
    <textarea name="exclusions" rows="8"></textarea>
  </fieldset>

  <fieldset><legend>Fees</legend>
    <div class="row">
      <div><label>Amount (Rs, excl. GST)</label><input type="number" name="amount" min="1" step="1" required></div>
      <div><label>Frequency</label>
        <select name="frequency"><option value="pm">per month</option><option value="pa">per annum</option><option value="once">one-time</option></select></div>
    </div>
    <label>Billing</label><input name="billing">
    <div class="row">
      <div><label>Payment terms</label>
        <select name="payDays"><option>7</option><option selected>15</option><option>30</option></select></div>
      <div><label>Yearly increment %</label><input type="number" name="increment" min="0" step="0.5" value="10" required></div>
    </div>
  </fieldset>

  <fieldset><legend>Indefine signatory</legend>
    <label>Partner</label><select name="partner"></select>
    <label>Signature image (optional, PNG/JPG; not saved anywhere)</label>
    <input type="file" id="sigFile" accept="image/png,image/jpeg">
  </fieldset>

  <div class="actions">
    <button type="button" class="primary" id="btnPdf">Print / Save as PDF</button>
    <button type="button" class="primary" id="btnDoc">Download Word (.doc)</button>
    <button type="button" id="btnSave">Save form (.json)</button>
    <button type="button" id="btnLoad">Load form (.json)</button>
    <input type="file" id="loadFile" accept="application/json" hidden>
  </div>
</form>

<div id="sheet">
  <img class="lh-head" src="__HEAD__" alt="Indefine letterhead">
  <table class="pg">
    <thead><tr><td><div class="sp-h"></div></td></tr></thead>
    <tbody><tr><td><div class="letter" id="letter"></div></td></tr></tbody>
    <tfoot><tr><td><div class="sp-f"></div></td></tr></tfoot>
  </table>
  <img class="lh-foot" src="__FOOT__" alt="">
</div>
</div>

<script>
// ===== EDIT HERE: one entry per partner who signs engagement letters =====
const PARTNERS = [
  { name: 'Partner Name 1', designation: 'Partner', phone: '+91 86609 49078', email: 'info@indefine.in' },
  { name: 'Partner Name 2', designation: 'Partner', phone: '+91 86609 49078', email: 'info@indefine.in' },
];

// ===== EDIT HERE: the three letter types and their default wording =====
const COMMON_EXCLUSIONS = [
  'Statutory audit, tax audit, certifications and any other attest function.',
  'Registrations and licences with any government department.',
  'Provisional or projected financial statements.',
  'Notices, assessments and representations before any authority, including those relating to periods before this engagement.',
  'One-time assignments.',
  'Digital signature certificates.',
  'Government fees, taxes, interest and late fees payable by the client.',
  'Any other work not expressly listed under Scope of Services.',
];
const TYPES = {
  retainer: {
    label: 'Monthly retainership',
    subject: 'Engagement letter for monthly retainership',
    frequency: 'pm',
    billing: 'monthly in advance',
    services: [
      'Accounting and maintenance of books of accounts.',
      'Books will be maintained in Tally. Subscription charges will be borne by Indefine.',
      'Payroll processing - salary workings and monthly statutory compliances (ESI, PF, PT and TDS on salaries).',
      'TDS and GST compliances of the company.',
      'Finalisation of books of accounts and preparation of financial statements.',
      'Income-tax return of the company.',
      'GST annual return (GSTR-9 and GSTR-9C) - if applicable.',
    ],
    exclusions: COMMON_EXCLUSIONS,
  },
  annual: {
    label: 'Annual compliance (ROC & income-tax)',
    subject: 'Engagement letter for annual compliance services',
    frequency: 'pa',
    billing: 'on completion of each deliverable',
    services: [
      'Preparation of financial statements from the books of accounts maintained by the company.',
      'Filing of financial statements (AOC-4) and annual return (MGT-7 / MGT-7A) with the Registrar of Companies.',
      'Drafting of notices, agenda and minutes for board meetings and the annual general meeting.',
      'Maintenance of statutory registers under the Companies Act, 2013.',
      'DIR-3 KYC for the directors.',
      'Computation of advance tax and filing of the income-tax return of the company.',
    ],
    exclusions: ['Monthly bookkeeping, payroll, GST and TDS compliances.', ...COMMON_EXCLUSIONS],
  },
  vcfo: {
    label: 'Virtual CFO',
    subject: 'Engagement letter for Virtual CFO services',
    frequency: 'pm',
    billing: 'monthly in advance',
    services: [
      'Monthly MIS reports and review with the management.',
      'Budgeting and budget-versus-actual analysis.',
      'Cash flow forecasting and working capital monitoring.',
      'Review of books of accounts maintained by the in-house team.',
      'Oversight of the statutory compliance calendar (GST, TDS, ROC and income-tax).',
      'Board and investor reporting packs.',
      'Monthly review meeting with the management.',
    ],
    exclusions: ['Day-to-day bookkeeping and payroll processing.', 'Fund raising, valuation and due diligence.', ...COMMON_EXCLUSIONS],
  },
};

const FIRM = 'Indefine';
const ENTITY = 'Streamlining Workflows Consultancy Private Limited';
const FREQ = { pm: 'per month', pa: 'per annum', once: 'one-time' };

// ===== General terms of engagement (same for all three types) =====
const ANNEXURE = `
<p>This engagement is governed by the following terms unless the parties agree otherwise in writing. In these terms, "Indefine", "we" and "us" mean Indefine, a unit of ${ENTITY}, and "Client", "you" and "your" mean the entity named in the engagement letter.</p>
<h3>Our commitment</h3>
<p>We will provide the services set out in the engagement letter, or such variations as may subsequently be agreed in writing between us, with reasonable skill and care, in accordance with the professional standards expected of us, and in a timely manner. The nature and content of any advice we provide will necessarily reflect the scope and limitations of our engagement, the amount and accuracy of information provided to us, and the time within which the advice is required. We will not normally seek to verify or check information provided to us by you or by others on your behalf, and you acknowledge that we are entitled to rely on such information in performing our obligations under this engagement. Where general information or advice is provided, its applicability will depend on the particular circumstances in which it is used, of which we may not be aware, and it should be viewed accordingly. For any particular transaction, specific advice should always be sought and all material information relating to it provided to us.</p>
<h3>Limitation of the scope</h3>
<p>Advice rendered by us on regulatory matters is based on our interpretation of the law and is not binding on any regulator; there can be no assurance that a regulator will not take a position contrary to our advice. Unless specifically requested, we are under no obligation to inform you of changes in law or practice that occur after our advice has been rendered.</p>
<p>Except to the extent you request and we agree in writing, we will not seek to verify the accuracy of the data, information and explanations provided by you, for which you are solely responsible. Non-availability of information we have requested may affect our ability to complete the work, and we will inform you of any resulting restriction on our work or on the reliance that may be placed on it.</p>
<p>In no circumstances shall we be liable, other than in the event of our bad faith or wilful default, for any loss or damage arising from information material to our work being withheld, concealed or misrepresented to us by your directors, employees or agents or any other person of whom we make enquiries, unless such withholding, concealment or misrepresentation was evident without further enquiry from the information provided to us.</p>
<h3>Your commitment</h3>
<p>You are responsible for providing us with complete, accurate, timely and relevant information and for carrying out the obligations ascribed to you or to others under your control. We will communicate cut-off dates for the information needed for each statutory filing. We are not responsible for any consequence, including interest, late fees or penalties, arising from information or approvals received after those dates, from incomplete information, or from non-payment of taxes and dues by you. You agree to keep us informed of any material development that may have a bearing on our engagement.</p>
<h3>Access to portals and credentials</h3>
<p>Where you share login credentials for government portals (including GST, income-tax, TRACES, MCA, EPFO and ESIC) or banking and accounting systems, we will use them only for the purposes of this engagement. You remain responsible for authorising each filing, for approving one-time passwords and for changing the credentials when this engagement ends.</p>
<h3>Information and confidentiality</h3>
<p>The reports, letters, information and advice we provide during this engagement are given in confidence solely for the purpose of this engagement, on the condition that you will not, save as required by law or by an order of a court, tribunal or other authority, disclose them to any third party without our prior written consent.</p>
<p>Each party shall (1) protect the other's confidential information in a reasonable and appropriate manner and in accordance with applicable professional standards, (2) use it only to perform its obligations under this engagement, and (3) reproduce it only as required for that purpose. These obligations do not apply to information that (a) is generally available to the public, (b) is or becomes available to a party on a non-confidential basis from another source, (c) is disclosed by the owning party to a third party without restriction, (d) is developed independently by a party, or (e) is required to be disclosed by law. We may disclose confidential information to government agencies authorised to request it under applicable law, and shall not be liable for such disclosure.</p>
<p>These confidentiality obligations continue for twelve months after completion of our work or termination of this engagement. In relation to matters in the public domain, we may name you and briefly describe the work we have done for you in our list of references, proposals and internal business planning documents.</p>
<h3>Personal data</h3>
<p>In providing payroll and other services we may process personal data of your employees, directors and customers. We will process such data only on your instructions and for the purposes of this engagement, and will maintain reasonable security safeguards to protect it. You confirm that you have given any notice and obtained any consent required under the Digital Personal Data Protection Act, 2023 for sharing such data with us.</p>
<h3>Communication by electronic mail</h3>
<p>We may communicate with you and exchange documents electronically, unless you request otherwise on a specific matter. Electronic communication carries inherent risks: messages may be lost, delayed, intercepted, corrupted or altered. Each party will use reasonable endeavours to keep its communications free of viruses and harmful material. We shall have no liability to you, other than for our bad faith or wilful default, for any error, omission, claim or loss arising from the electronic communication of information to you or your reliance on it.</p>
<h3>Fees, expenses and suspension of work</h3>
<p>Government fees, statutory interest, late fees and penalties, digital signature charges and out-of-pocket expenses incurred at your request are payable by you at actuals and are not included in our professional fees. If any invoice remains unpaid thirty days after its due date, we may suspend work by written notice until it is paid, and we shall not be responsible for any default, late fee or penalty arising during the period of suspension.</p>
<h3>Limitation of liability</h3>
<p>While we believe our deliverables will reflect a reasonable interpretation of the applicable accounting standards, tax laws and their practice in India, there can be no assurance that courts, tribunals or other authorities will agree with our analysis or conclusions. Our liability is limited solely to direct damages sustained as a result of the gross negligence or wilful misconduct of our personnel in performing the services, and shall in aggregate not exceed the professional fees paid to us for the service giving rise to the claim in the twelve months preceding the claim. We shall not be liable for any indirect or consequential damages, even if advised of their possibility.</p>
<p>You agree to hold harmless Indefine, its directors, partners and employees from all actions, claims, proceedings, losses, damages, costs and expenses that they may suffer arising from or in connection with the provision of the services, except to the extent finally determined to have resulted from their gross negligence or wilful misconduct. This provision survives termination of the engagement.</p>
<h3>Indemnification</h3>
<p>With respect to third parties and third-party claims, you and your affiliated entities shall indemnify and hold harmless Indefine, its affiliates, directors, partners and personnel, to the full lawful extent, against any claims, liabilities, costs and expenses brought against, paid or incurred by Indefine at any time and in any way arising out of or relating to our services, your use of the deliverables or this engagement, except to the extent finally determined to have resulted from the gross negligence or wilful misconduct of Indefine personnel.</p>
<h3>Conflict of interest</h3>
<p>Subject to the confidentiality restrictions above, Indefine and its affiliates may render similar services to other parties, including your competitors. Where you have given us prior notice of a potential conflict, we shall either obtain a waiver from both parties or, failing such waiver (which shall not be unreasonably withheld or delayed), refrain from rendering services in a manner that would create a conflict of interest for you.</p>
<h3>Intellectual property rights</h3>
<p>We retain all copyright and other intellectual property rights in everything developed by us before or during the engagement, including systems, methodologies, software, know-how and working papers, and in all reports, written advice and other materials provided to you. You may distribute copies of these materials within your own organisation for the purposes of this engagement.</p>
<h3>Non-solicitation</h3>
<p>During the engagement and for twelve months after it ends, you will not directly employ or engage any of our personnel who worked on your engagement without our prior written consent.</p>
<h3>Termination</h3>
<p>Either party may terminate this engagement by forty-five days' notice in writing to the other party's correspondence address or email ID set out in the engagement letter. Either party may terminate immediately by written notice if the other commits a material breach, including non-payment of fees, that is not remedied within fifteen days of written notice. On termination, fees for work performed and expenses incurred up to the date of termination are payable. On settlement of all dues, we will hand over your books, records and documents in our possession; we retain our working papers.</p>
<h3>Force majeure</h3>
<p>Neither party shall be liable for any failure or delay in performing its obligations under this engagement if the failure or delay is due to causes beyond its reasonable control.</p>
<h3>Severance of terms</h3>
<p>If any of these terms is held to be invalid, the remaining terms continue in full force and effect.</p>
<h3>Entire agreement</h3>
<p>The engagement letter together with these terms contains the entire agreement between the parties and supersedes all prior understandings between Indefine and the Client with regard to the services. It may be changed only by written agreement signed by the party against whom enforcement of any waiver, change, modification, extension or discharge is sought.</p>
<h3>Acceptance and notices</h3>
<p>The engagement letter may be accepted by signing and returning a scanned copy or by electronic signature, each of which is as effective as an original. Notices under this engagement shall be in writing and sent to the addresses or email IDs set out in the engagement letter.</p>
<h3>Governing law and jurisdiction</h3>
<p>These terms are governed by the laws of India, and any dispute arising out of this engagement is subject to the exclusive jurisdiction of the courts at Bengaluru.</p>`;

// ===== helpers =====
const f = document.getElementById('f');
const $ = id => document.getElementById(id);
let sigData = '';   // partner signature as a data URL; lives only in this tab
// Every user-typed value passes through esc() before it reaches the letter markup.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = s => String(s || '').split('\n').map(l => l.replace(/^\s*(?:[-•*]|[a-z0-9]{1,3}[.)])\s+/i, '').trim()).filter(Boolean);
const parseDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ord = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const fmtDate = dt => dt ? `${ord(dt.getDate())} ${dt.toLocaleString('en-GB', { month: 'long' })} ${dt.getFullYear()}` : '—';

// Day before the same date `months` later (1 Apr 2026 + 12 → 31 Mar 2027); clamps 31 Jan + 1 → 27 Feb.
function endDate(start, months) {
  const t = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(start.getDate(), last) - 1);
}

// Indian numbering: 125000 → "One Lakh Twenty Five Thousand"
function words(n) {
  n = Math.floor(n);
  if (!n) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => n < 20 ? a[n] : t[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  const out = [];
  if (n >= 1e7) { out.push(words(Math.floor(n / 1e7)) + ' Crore'); n %= 1e7; }
  if (n >= 1e5) { out.push(two(Math.floor(n / 1e5)) + ' Lakh'); n %= 1e5; }
  if (n >= 1e3) { out.push(two(Math.floor(n / 1e3)) + ' Thousand'); n %= 1e3; }
  if (n >= 100) { out.push(a[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n) out.push(two(n));
  return out.join(' ');
}

const fy = dt => { if (!dt) return ''; const y = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1; return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`; };

function state() {
  return { ...Object.fromEntries(new FormData(f)), autorenew: f.autorenew.checked };
}

// ===== the letter =====
function render(d, sigSrc) {
  const p = PARTNERS[d.partner] || PARTNERS[0];
  const start = parseDate(d.start);
  const term = Math.max(1, parseInt(d.term) || 12);
  const end = start && endDate(start, term);
  const amt = Number(d.amount) || 0;
  const salute = d.salutation || (d.sigName || '').trim().split(/\s+/)[0] || 'Sir/Madam';
  const contact = [d.phone && `Phone: ${esc(d.phone)}`, d.email && `Email: ${esc(d.email)}`].filter(Boolean).join('<br>');
  const inc = Number(d.increment) || 0;

  const duration = d.autorenew
    ? `This engagement is effective from <b>${fmtDate(start)}</b> for an initial period of ${term} months, ending on ${fmtDate(end)}. It shall renew automatically for successive periods of twelve months on the same terms, with the fee revised as set out under Terms of payment, unless either party gives written notice of non-renewal at least forty-five days before the end of the current period.`
    : `This engagement is effective from <b>${fmtDate(start)}</b> for a period of ${term} months, ending on ${fmtDate(end)}, and will not renew automatically. Any extension will be agreed in writing.`;

  const revision = inc > 0
    ? `The fee shall be revised by <b>${inc}%</b> on each anniversary of the commencement date. Any further revision on account of a change in the volume or complexity of work will be agreed in writing.`
    : `Any revision of the fee on account of a change in the volume or complexity of work will be agreed in writing.`;

  const excl = lines(d.exclusions);

  return `
<p class="right"><b>Date:</b> ${fmtDate(parseDate(d.letterDate))}${d.ref ? `<br><b>Ref:</b> ${esc(d.ref)}` : ''}</p>
<p class="l">To,<br><b>${esc(d.client)}</b><br>${lines(d.address).map(esc).join('<br>')}${contact ? '<br>' + contact : ''}</p>
<p><b>Subject:</b> ${esc(d.subject)}</p>
<p>Dear ${esc(salute)},</p>
<p>Based on our discussion on the above subject, we set out below the services to be rendered by us and the terms on which we will render them.</p>

<h3>Scope of services</h3>
<ol type="a">${lines(d.services).map(s => `<li>${esc(s)}</li>`).join('')}</ol>

<h3>Professional charges</h3>
<p>Based on the above scope of services, our professional fee is <b>Rs ${amt.toLocaleString('en-IN')}/- ${FREQ[d.frequency]}</b> (Rupees ${words(amt)} only), exclusive of GST, which will be charged at the applicable rate.</p>

<h3>Commencement date and duration</h3>
<p>${duration}</p>

<h3>The team</h3>
<p>For executing this assignment, the team shall work remotely.</p>

${excl.length ? `<h3>Services not included in the scope</h3>
<p>The following are outside the scope of this engagement and, where requested, will be billed separately on terms agreed at the time:</p>
<ul>${excl.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}

<h3>Terms of payment</h3>
<p>Our fees will be billed ${esc(d.billing)}. Invoices are payable within <b>${esc(d.payDays)} days</b> of the invoice date. Delayed payments attract interest at 2% per month on the amount outstanding. ${revision}</p>

<p>We request you to countersign a copy of this letter and return it to us as a token of your acceptance of the above terms and the General Terms of Engagement in the annexure.</p>
<p>Assuring you of our best services and prompt attention always.</p>

<div class="keep">
<p class="l">Thanking you,<br>Yours faithfully,<br>For <b>${FIRM}</b><br>(a unit of ${ENTITY})</p>
${sigSrc ? `<img class="sig" src="${esc(sigSrc)}" height="48" alt="">` : '<p><br><br></p>'}
<p class="l"><b>${esc(p.name)}</b><br>${esc(p.designation)}<br>${esc(p.phone)} | ${esc(p.email)}</p>
</div>

<h2 class="pb">Acceptance / Appointment Confirmation</h2>
<p>We have read the above engagement letter and the annexure in detail. We are pleased to engage ${FIRM}, a unit of ${ENTITY}, to render the above services to <b>${esc(d.client)}</b> on the terms and conditions set out in this letter and the annexure.</p>
<div class="keep">
<p>For <b>${esc(d.client)}</b></p>
<p class="l"><br><br><br>______________________________<br>Signature and seal</p>
<p class="l">Name: ${esc(d.sigName)}<br>${d.sigDesig ? `Designation: ${esc(d.sigDesig)}<br>` : ''}${d.sigPhone ? `Phone: ${esc(d.sigPhone)}<br>` : ''}${d.sigEmail ? `Email: ${esc(d.sigEmail)}` : ''}</p>
<p class="l">Date: <span class="blank">&nbsp;</span><br><br>Place: <span class="blank">&nbsp;</span></p>
</div>

<h2 class="pb">Annexure<br>General Terms of Engagement</h2>
${ANNEXURE}`;
}

const letterEl = $('letter');
function refresh() { letterEl.innerHTML = render(state(), sigData); }

// ===== type switching =====
let curType;
function applyType() {
  const t = TYPES[f.type.value];
  f.subject.value = t.subject;
  f.frequency.value = t.frequency;
  f.billing.value = t.billing;
  f.services.value = t.services.join('\n');
  f.exclusions.value = t.exclusions.join('\n');
  curType = f.type.value;
  refresh();
}
f.type.onchange = () => {
  const old = TYPES[curType];
  const edited = f.services.value !== old.services.join('\n') || f.exclusions.value !== old.exclusions.join('\n');
  if (edited && !confirm('Replace the services and exclusions you have edited with the defaults for this letter type?')) { f.type.value = curType; return; }
  applyType();
};

// ===== output =====
const fileBase = () => { const d = state(); return `EL_${(d.client || 'Client').trim().replace(/[^\w]+/g, '_')}_FY${fy(parseDate(d.start))}`; };
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btnPdf').onclick = () => {
  if (!f.reportValidity()) return;
  const t = document.title; document.title = fileBase();   // Chrome uses the title as the PDF file name
  window.print(); document.title = t;
};

// .doc = MHTML (HTML + images in one file), which Word opens directly.
// ponytail: letterhead sits at the top/bottom of the document, not in Word's page header/footer; move it there in Word if needed.
function buildDoc() {
  const imgs = { 'head.jpg': $('sheet').querySelector('.lh-head').src, 'foot.jpg': $('sheet').querySelector('.lh-foot').src };
  if (sigData) imgs['sig.img'] = sigData;
  const loc = n => 'file:///C:/el/' + n;
  const css = [...document.styleSheets[0].cssRules].filter(r => r.selectorText && r.selectorText.startsWith('.letter')).map(r => r.cssText).join('\n');
  const body = render(state(), sigData ? loc('sig.img') : '');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>@page Section1 { size:595.3pt 841.9pt; margin:36pt 54pt 36pt 54pt; } div.Section1 { page:Section1; }
${css}
.letter .pb { page-break-before:always; }</style></head>
<body><div class="Section1"><img src="${loc('head.jpg')}" width="624" height="81"><div class="letter">${body}</div><img src="${loc('foot.jpg')}" width="624" height="83"></div></body></html>`
    .replace(/[^\x00-\x7f]/g, c => '&#' + c.codePointAt(0) + ';');   // keep the part 7-bit safe
  const B = '----=_IndefineEL';
  const parts = [`Content-Type: text/html; charset="utf-8"\r\nContent-Location: ${loc('letter.htm')}\r\n\r\n${html}`];
  for (const [name, url] of Object.entries(imgs)) {
    const [, mime, b64] = url.match(/^data:([^;]+);base64,(.*)$/);
    parts.push(`Content-Type: ${mime}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${loc(name)}\r\n\r\n${b64.match(/.{1,76}/g).join('\r\n')}`);
  }
  return `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${B}"; type="text/html"\r\n\r\n` + parts.map(p => `--${B}\r\n${p}\r\n`).join('') + `--${B}--\r\n`;
}
$('btnDoc').onclick = () => {
  if (!f.reportValidity()) return;
  download(new Blob([buildDoc()], { type: 'application/msword' }), fileBase() + '.doc');
};

$('btnSave').onclick = () => download(new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' }), fileBase() + '.json');
$('btnLoad').onclick = () => $('loadFile').click();
$('loadFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    for (const [k, v] of Object.entries(d)) {
      const el = f.elements[k];
      if (el) el.type === 'checkbox' ? (el.checked = !!v) : (el.value = v);
    }
    curType = f.type.value;
    refresh();
  } catch { alert('That file is not a saved engagement letter form.'); }
  e.target.value = '';
};

$('sigFile').onchange = e => {
  const file = e.target.files[0];
  if (!file) { sigData = ''; refresh(); return; }
  const r = new FileReader();
  r.onload = () => { sigData = r.result; refresh(); };
  r.readAsDataURL(file);
};

// ===== init =====
f.type.append(...Object.entries(TYPES).map(([k, t]) => new Option(t.label, k)));
f.partner.append(...PARTNERS.map((p, i) => new Option(p.name, i)));
f.letterDate.value = new Date().toLocaleDateString('en-CA');
f.addEventListener('input', refresh);
applyType();

// Self-check: open the file with #test on the end of the URL; the tab title reads SELF-CHECK PASSED.
if (location.hash === '#test') {
  const eq = (a, b) => { if (a !== b) throw new Error(`expected "${b}", got "${a}"`); };
  eq(words(13500), 'Thirteen Thousand Five Hundred');
  eq(words(125000), 'One Lakh Twenty Five Thousand');
  eq(words(10000000), 'One Crore');
  eq(words(1234567890), 'One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety');
  eq(fmtDate(endDate(new Date(2026, 3, 1), 12)), '31st March 2027');
  eq(fmtDate(endDate(new Date(2026, 0, 31), 1)), '27th February 2026');
  eq(fmtDate(endDate(new Date(2028, 0, 31), 1)), '28th February 2028');
  eq(fmtDate(new Date(2024, 6, 11)), '11th July 2024');
  eq(fmtDate(new Date(2024, 6, 22)), '22nd July 2024');
  eq(fy(new Date(2026, 2, 31)), '25-26');
  eq(fy(new Date(2026, 3, 1)), '26-27');
  eq(lines('a. One\n- Two\n\n3) Three\nITR filing').join('|'), 'One|Two|Three|ITR filing');
  document.title = 'SELF-CHECK PASSED';
}
</script>
</body>
</html>
```

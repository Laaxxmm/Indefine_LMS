// GST Prep checklist: rules as data (GST_CHECKLIST, the default SopPack "gst" v1.0.0) and their
// deterministic implementations (gstRegistry). Each implementation reads the parsed inputs and the
// computation (analyse()) — never a model output's numbers — and cites a quote + location.
//
// Severity policy:
//   block — the draft cannot be relied on or filed as is, or the error carries direct legal
//           exposure that a partner must sign off (invalid GSTIN, unaccounted RCM, wrong tax head
//           for the place of supply, HSN digits short, duplicate document numbers, credit note out
//           of time, prior-period GSTR-1 > 3B shortfall, missing IRN for an e-invoice-liable
//           client, SopPack and module rates out of step).
//   warn  — the draft already treats the item conservatively (ITC deferred / reversed / not
//           claimed) but a person must follow up or confirm a judgement (2B mismatches, blocked
//           credits, rule 37, series gaps, credit-note linkage, lateness, free supplies).
//   info  — classification the reviewer should glance at (B2CL invoices).
import { createRuleRegistry, type ChecklistPack, type CheckOutcome, type RuleDefinition } from "@/lib/agents/core/checklist";
import type { CheckInput } from "@/lib/agents/core/runner";
import { validateGstin } from "@/lib/agents/onboarding/validators";
import { BLOCKED_CATEGORIES, GST_CONFIG, GST_RULE_DEFAULTS, GST_VERIFY_NOTES, RCM_SERVICES, type AatoSlab } from "./config";
import { analyse, differs, rule37Rows, sign, type Analysis } from "./compute";
import { dayAfterFyEnd, fyOfDay, plainRupees, taxTotal, type TaxSplit } from "./money";
import { dupKey } from "./registers";
import { INSUFFICIENT } from "./tasks";
import type { GstExtract, GstInput } from "./types";

export type GstCheckInput = CheckInput<GstInput, GstExtract>;

const MAX_LIST = 5;
const ok = (): CheckOutcome => ({ status: "pass" });
const na = (message: string): CheckOutcome => ({ status: "na", message });
const fail = (message: string, quote: string, location: string): CheckOutcome => ({ status: "fail", message, evidence: { quote, location } });
const inr = (paise: number) => `₹${plainRupees(paise)}`;
const more = (n: number) => (n > MAX_LIST ? ` (+${n - MAX_LIST} more)` : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isSafeInteger(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const taxText = (t: TaxSplit) => `IGST ${plainRupees(t.igst)}, CGST ${plainRupees(t.cgst)}, SGST ${plainRupees(t.sgst)}${t.cess ? `, cess ${plainRupees(t.cess)}` : ""}`;
const A = (ci: GstCheckInput): Analysis => analyse(ci.extracted);

type Hit = { quote: string; loc: string; text: string };
function listFail(hits: Hit[], head: string): CheckOutcome {
  if (!hits.length) return ok();
  const shown = hits.slice(0, MAX_LIST).map((h) => h.text).join("; ");
  return fail(`${head}: ${shown}${more(hits.length)}`, hits[0].quote, hits[0].loc);
}

// ------------------------------------------------------------------ implementations

function gstinValid(ci: GstCheckInput): CheckOutcome {
  const x = ci.extracted;
  const seen = new Set<string>();
  const hits: Hit[] = [];
  const check = (g: string | null, loc: string, who: string) => {
    if (!g || seen.has(`${g}|${who}`)) return;
    seen.add(`${g}|${who}`);
    const issues = validateGstin(g);
    if (issues.length) hits.push({ quote: g, loc, text: `${who} ${issues[0]}` });
  };
  check(x.profile.gstin, "profile.json gstin", "client");
  for (const d of x.sales) check(d.gstin, d.loc, d.party || "customer");
  for (const p of A(ci).purchases) {
    check(p.gstin, p.loc, p.supplier || "supplier");
    if (!p.gstin && !p.rcm && taxTotal(p.booksTax) > 0) hits.push({ quote: p.number, loc: p.loc, text: `${p.supplier || "supplier"} charged tax (${taxText(p.booksTax)}) but the register has no supplier GSTIN` });
  }
  for (const p of x.payables) check(p.gstin, p.loc, p.supplier || "supplier");
  for (const d of x.gstr2b) check(d.ctin, d.loc, d.tradeName || "2B supplier");
  return listFail(hits, `${hits.length} GSTIN problem(s)`);
}

function missingIn2b(ci: GstCheckInput): CheckOutcome {
  const a = A(ci);
  const rows = a.recon.filter((r) => r.status === "missing-in-2b");
  const hits = rows.map((r) => ({ quote: `${r.gstin} ${r.number}`, loc: r.books!.loc, text: `${r.party} ${r.docType} ${r.number} (${taxText(r.booksTax)})` }));
  return listFail(hits, `${rows.length} purchase document(s) not in GSTR-2B; ITC of ${inr(taxTotal(a.itc.deferred))} deferred, follow up with the supplier`);
}

function missingInBooks(ci: GstCheckInput): CheckOutcome {
  const a = A(ci);
  const rows = a.recon.filter((r) => r.status === "missing-in-books");
  const hits = rows.map((r) => ({ quote: `${r.gstin} ${r.number}`, loc: r.twoB!.loc, text: `${r.party} ${r.docType} ${r.number} (${taxText(r.twoBTax)})` }));
  return listFail(hits, `${rows.length} GSTR-2B document(s) not in the purchase register (ITC ${inr(taxTotal(a.itc.notBooked))} not claimed); check for unrecorded purchases or misuse of the GSTIN`);
}

function valueDiff(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const tol = num(rule.params?.tolerancePaise, GST_CONFIG.reconTolerancePaise);
  const rows = A(ci).recon.filter((r) => (r.status === "matched" || r.status === "value-diff") && differs(r.booksTaxable, r.booksTax, r.twoBTaxable, r.twoBTax, tol));
  const hits = rows.map((r) => ({
    quote: `${r.gstin} ${r.number}`,
    loc: `${r.books!.loc} vs ${r.twoB!.loc}`,
    text: `${r.number}: books taxable ${plainRupees(r.booksTaxable)} (${taxText(r.booksTax)}) vs 2B ${plainRupees(r.twoBTaxable)} (${taxText(r.twoBTax)})`,
  }));
  return listFail(hits, `${rows.length} document(s) differ from GSTR-2B by more than ${inr(tol)}; the draft claims the lower amount`);
}

function itcUnavailable(ci: GstCheckInput): CheckOutcome {
  const rows = A(ci).recon.filter((r) => r.status === "itc-unavailable");
  const hits = rows.map((r) => ({ quote: `${r.gstin} ${r.number}`, loc: r.twoB!.loc, text: `${r.number}: GSTR-2B says ITC not available${r.twoB!.reason ? ` (${r.twoB!.reason})` : ""}` }));
  return listFail(hits, `${rows.length} document(s) with ITC not available in GSTR-2B; not claimed (Table 4(D)(2))`);
}

function blockedCredit(ci: GstCheckInput): CheckOutcome {
  const a = A(ci);
  const hits: Hit[] = [];
  for (const p of a.purchases) {
    const tax = p.rcm ? p.rcmTax : p.booksTax;
    if (!p.blocked || taxTotal(tax) * sign(p.docType) <= 0) continue;
    hits.push({ quote: p.key, loc: p.loc, text: `${p.number} "${p.key}" → ${BLOCKED_CATEGORIES[p.blocked].split(":")[0]} (${taxText(tax)})` });
  }
  return listFail(hits, `ITC on blocked credits u/s 17(5): ${inr(taxTotal(a.itc.b1))} moved to Table 4(B)(1); confirm the classification`);
}

/** Every insufficient_evidence model answer is a question for the reviewer (ADR-008), never a silent default. */
function modelQuestions(ci: GstCheckInput): CheckOutcome {
  const x = ci.extracted;
  const a = A(ci);
  const hits: Hit[] = [];
  for (const l of x.ledgers) {
    const what = [l.blockedCategory === INSUFFICIENT ? "whether ITC is blocked u/s 17(5)" : "", l.rcmService === INSUFFICIENT ? "whether reverse charge applies" : ""].filter(Boolean).join(" and ");
    if (!what) continue;
    const doc = a.purchases.find((p) => p.key === l.ledger);
    hits.push({ quote: l.ledger, loc: doc?.loc ?? x.sources.purchases.file, text: `ledger "${l.ledger}": the books do not show ${what}${l.note ? ` (${l.note})` : ""}; the draft treats it as neither until answered` });
  }
  for (const h of x.hsnReads) {
    if (h.status === INSUFFICIENT) hits.push({ quote: h.description, loc: h.location, text: `no HSN/SAC is written for "${h.description}"${h.note ? ` (${h.note})` : ""}` });
  }
  return listFail(hits, `${hits.length} question(s) the documents cannot answer; ask the client or decide before approval`);
}

function rcmLiability(ci: GstCheckInput): CheckOutcome {
  const rows = A(ci).purchases.filter((p) => p.rcmUnmarked);
  const total = rows.reduce((n, p) => n + taxTotal(p.rcmTax), 0);
  const hits = rows.map((p) => ({ quote: p.key, loc: p.loc, text: `${p.supplier || "supplier"} ${p.number} "${p.key}" is ${RCM_SERVICES[p.rcmService!].label.toLowerCase()} — not marked reverse charge in the books (${taxText(p.rcmTax)})` }));
  return listFail(hits, `Reverse-charge liability not accounted in the books: ${inr(total)} added to Table 3.1(d), payable in cash`);
}

function hsnSlabs(rule: RuleDefinition): AatoSlab<{ minDigits: number; b2cOptional: boolean }>[] {
  const p = rule.params?.slabs;
  if (!Array.isArray(p) || !p.length) return GST_RULE_DEFAULTS.hsnSlabs;
  return p.map((s: Record<string, unknown>) => ({ uptoAatoPaise: typeof s.uptoAatoPaise === "number" ? s.uptoAatoPaise : null, minDigits: num(s.minDigits, 6), b2cOptional: s.b2cOptional === true }));
}

function hsnDigits(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const aato = ci.extracted.profile.aatoPaise;
  const slab = hsnSlabs(rule).find((s) => s.uptoAatoPaise === null || aato <= s.uptoAatoPaise) ?? { minDigits: 6, b2cOptional: false };
  const hits: Hit[] = [];
  for (const d of A(ci).sales) {
    if (!d.registered && slab.b2cOptional) continue;
    for (const l of d.lines) {
      if (!l.hsn) hits.push({ quote: d.number.trim(), loc: d.loc, text: `${d.number.trim()} "${l.description || "line"}" has no HSN/SAC` });
      else if (l.hsn.replace(/\D/g, "").length < slab.minDigits) hits.push({ quote: l.hsn, loc: d.loc, text: `${d.number.trim()} HSN ${l.hsn} has fewer than ${slab.minDigits} digits` });
    }
  }
  return listFail(hits, `HSN must have at least ${slab.minDigits} digits for AATO ${inr(aato)}`);
}

function duplicates(ci: GstCheckInput): CheckOutcome {
  const x = ci.extracted;
  const hits: Hit[] = [];
  const scan = <T extends { loc: string; number: string; docType: string }>(docs: T[], keyOf: (d: T) => string, what: string) => {
    const first = new Map<string, T>();
    for (const d of docs) {
      const k = keyOf(d);
      const f = first.get(k);
      if (f) hits.push({ quote: `${JSON.stringify(f.number)} and ${JSON.stringify(d.number)}`, loc: `${f.loc} and ${d.loc}`, text: `${what} ${JSON.stringify(d.number)} repeats ${JSON.stringify(f.number)}` });
      else first.set(k, d);
    }
  };
  scan(x.sales, (d) => `${d.docType}|${dupKey(d.number)}`, "sales document");
  scan(x.purchases, (d) => `${d.gstin ?? d.supplier.toLowerCase()}|${d.docType}|${dupKey(d.number)}`, "purchase bill");
  return listFail(hits, `${hits.length} duplicate document number(s) (compared ignoring case and spaces)`);
}

function gaps(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const max = num(rule.params?.maxListed, 20);
  const rows = A(ci).gstr1.docs.filter((r) => r.missing.length);
  const file = ci.extracted.sources.sales.file;
  const hits = rows.map((r) => ({ quote: r.missing.slice(0, max).join(", "), loc: `${file} series ${r.prefix || "(no prefix)"} ${r.from} to ${r.to}`, text: `${r.nature} ${r.from}–${r.to}: ${r.missing.length} number(s) missing (${r.missing.slice(0, 3).join(", ")}${r.missing.length > 3 ? ", …" : ""})` }));
  return listFail(hits, `Gaps in the document series; listed under "Gaps — to be explained" in the Docs table (not reported as cancelled): confirm each number was cancelled, or find the missing invoice`);
}

function b2cl(ci: GstCheckInput): CheckOutcome {
  const rows = A(ci).gstr1.b2cl;
  const hits = rows.map((d) => ({ quote: d.number.trim(), loc: d.loc, text: `${d.number.trim()} to ${d.posResolved}, value ${plainRupees(d.value)}` }));
  return listFail(hits, `${rows.length} inter-state B2C invoice(s) above ${inr(GST_CONFIG.b2clThresholdPaise)} reported invoice-wise in B2CL`);
}

function notesLinked(ci: GstCheckInput): CheckOutcome {
  const hits = ci.extracted.sales.filter((d) => d.docType !== "INV" && !d.origNumber).map((d) => ({ quote: d.number.trim(), loc: d.loc, text: `${d.docType === "CRN" ? "credit" : "debit"} note ${d.number.trim()} to ${d.party} has no original invoice number` }));
  return listFail(hits, `Credit/debit notes not linked to an original invoice (s.34)`);
}

function noteTimeLimit(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const md = str(rule.params?.deadlineMonthDay, GST_RULE_DEFAULTS.creditNoteDeadlineMonthDay);
  const hits: Hit[] = [];
  for (const d of ci.extracted.sales) {
    if (d.docType !== "CRN" || !d.origDate) continue;
    const deadline = dayAfterFyEnd(fyOfDay(d.origDate), md);
    if (d.date > deadline) hits.push({ quote: `${d.number.trim()} ${d.date}`, loc: d.loc, text: `credit note ${d.number.trim()} dated ${d.date} against an invoice of ${d.origDate}: time limit was ${deadline}` });
  }
  return listFail(hits, `Credit notes issued after the s.34(2) time limit cannot reduce output tax`);
}

function taxTypeProblem(inter: boolean, tax: TaxSplit, rateBps: number): string | null {
  if (rateBps === 0 || taxTotal(tax) - tax.cess === 0) return null;
  if (inter && (tax.cgst !== 0 || tax.sgst !== 0)) return "inter-state supply charged CGST/SGST (should be IGST)";
  if (!inter && tax.igst !== 0) return "intra-state supply charged IGST (should be CGST + SGST)";
  if (!inter && Math.abs(tax.cgst - tax.sgst) > 100) return "CGST and SGST are not equal halves";
  return null;
}

function posTaxType(ci: GstCheckInput): CheckOutcome {
  const a = A(ci);
  const hits: Hit[] = [];
  for (const d of a.sales) {
    if (d.reverseCharge) continue;
    for (const l of d.lines) {
      const p = taxTypeProblem(d.interState, l.tax, l.rateBps);
      if (p) {
        hits.push({ quote: `${d.number.trim()}: ${taxText(l.tax)}`, loc: d.loc, text: `sales ${d.number.trim()} (place of supply ${d.posResolved}, client ${a.clientState}): ${p}` });
        break;
      }
    }
  }
  for (const d of a.purchases) {
    if (d.rcm || !d.gstin) continue;
    const pos = d.pos ?? a.clientState;
    for (const l of d.lines) {
      const p = taxTypeProblem(d.gstin.slice(0, 2) !== pos, l.tax, l.rateBps);
      if (p) {
        hits.push({ quote: `${d.number}: ${taxText(l.tax)}`, loc: d.loc, text: `purchase ${d.number} from ${d.gstin.slice(0, 2)} (place of supply ${pos}): ${p}` });
        break;
      }
    }
  }
  return listFail(hits, `Tax head does not match the place of supply`);
}

function rule37(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const days = num(rule.params?.days, GST_CONFIG.rule37Days);
  const a = A(ci);
  const rows = rule37Rows(ci.extracted.payables, a.periodInfo.end, days);
  const total = rows.reduce((n, r) => n + taxTotal(r.reversal), 0);
  const hits = rows.map((r) => ({ quote: `${r.doc.number} ${r.doc.date}`, loc: r.doc.loc, text: `${r.doc.supplier} ${r.doc.number} of ${r.doc.date}: ${r.days} days, ${plainRupees(r.unpaid)} unpaid` }));
  return listFail(hits, `ITC on invoices unpaid for more than ${days} days (rule 37): ${inr(total)} reversed in Table 4(B)(2); interest u/s 50 may apply`);
}

function lateness(ci: GstCheckInput): CheckOutcome {
  const a = A(ci);
  const x = ci.extracted;
  if (a.daysLate > 0) {
    return fail(
      `Filing expected ${a.daysLate} day(s) after the due date ${a.dueDate}: interest u/s 50 ≈ ${inr(taxTotal(a.interest))}, late fee ≈ ${inr(a.lateFee)}`,
      `expectedFilingDate ${x.profile.expectedFilingDate}`,
      "profile.json",
    );
  }
  const p = x.prev;
  if (p?.filedOn && p.dueOn && p.filedOn > p.dueOn) return fail(`Previous return (${p.period}) was filed after its due date ${p.dueOn}; confirm interest and late fee were paid`, `filedOn ${p.filedOn}`, p.loc);
  return ok();
}

function periodLock(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const p = ci.extracted.prev;
  if (!p) return na("No previous return figures given");
  const tol = num(rule.params?.tolerancePaise, GST_RULE_DEFAULTS.periodLockTolerancePaise);
  const gap = A(ci).prevGap;
  const heads = (["igst", "cgst", "sgst", "cess"] as const).filter((h) => gap[h] > tol);
  if (!heads.length) return ok();
  const h = heads[0];
  return fail(
    `Previous period ${p.period}: GSTR-1 liability exceeds GSTR-3B Table 3.1 by ${heads.map((k) => `${k.toUpperCase()} ${plainRupees(gap[k])}`).join(", ")}; pay with interest or explain (DRC-01B) before this period's GSTR-1`,
    `${h.toUpperCase()} GSTR-1 ${plainRupees(p.gstr1[h])} vs GSTR-3B ${plainRupees(p.gstr3b[h])}`,
    p.loc,
  );
}

function einvoice(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const limit = num(rule.params?.aatoPaise, GST_RULE_DEFAULTS.einvoiceAatoPaise);
  const aato = ci.extracted.profile.aatoPaise;
  if (aato <= limit) return na(`AATO ${inr(aato)} is not above the e-invoicing limit ${inr(limit)}`);
  const hits = A(ci)
    .sales.filter((d) => d.registered && !d.irn)
    .map((d) => ({ quote: d.number.trim(), loc: d.loc, text: `${d.docType} ${d.number.trim()} to ${d.gstin} has no IRN` }));
  return listFail(hits, `E-invoicing applies (AATO ${inr(aato)} > ${inr(limit)}): B2B documents without an IRN are not valid invoices`);
}

/** Values the computation uses, as the pack must state them. */
export function packConfigParams(): Record<string, unknown> {
  return {
    b2clThresholdPaise: GST_CONFIG.b2clThresholdPaise,
    interestRateBps: GST_CONFIG.interestRateBps,
    daysInYear: GST_CONFIG.daysInYear,
    lateFeePerDayPaise: GST_CONFIG.lateFee.perDayPaise,
    lateFeeNilPerDayPaise: GST_CONFIG.lateFee.nilPerDayPaise,
    lateFeeCaps: GST_CONFIG.lateFee.caps,
    lateFeeNilCapPaise: GST_CONFIG.lateFee.nilCapPaise,
    gstr3bMonthlyDay: GST_CONFIG.due.gstr3bMonthlyDay,
    qrmpDay22States: GST_CONFIG.due.qrmpDay22States,
    reconTolerancePaise: GST_CONFIG.reconTolerancePaise,
    rule37Days: GST_CONFIG.rule37Days,
    rcmRatesBps: GST_CONFIG.rcmRatesBps,
  };
}

function packConfig(_ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const want = packConfigParams();
  const params = rule.params ?? {};
  const hits: Hit[] = [];
  for (const [k, v] of Object.entries(want)) {
    if (!(k in params)) continue;
    if (JSON.stringify(params[k]) !== JSON.stringify(v)) hits.push({ quote: `${k}: pack ${JSON.stringify(params[k])}, module ${JSON.stringify(v)}`, loc: `SopPack rule gst.pack-config params.${k}`, text: `${k} differs (pack ${JSON.stringify(params[k])}, computation ${JSON.stringify(v)})` });
  }
  return listFail(hits, `The active SOP pack and the GST computation disagree; figures follow the computation until a release aligns them`);
}

// --- parameterised checks used by approved MistakeLog rules (not in the default pack)

function partyListed(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const listed = new Set((Array.isArray(rule.params?.gstins) ? rule.params.gstins : []).map((g) => String(g).trim().toUpperCase()));
  const x = ci.extracted;
  const hits: Hit[] = [];
  for (const d of x.purchases) if (d.gstin && listed.has(d.gstin)) hits.push({ quote: d.gstin, loc: d.loc, text: `purchase ${d.number} from listed GSTIN ${d.gstin}` });
  for (const d of x.sales) if (d.gstin && listed.has(d.gstin)) hits.push({ quote: d.gstin, loc: d.loc, text: `sale ${d.number.trim()} to listed GSTIN ${d.gstin}` });
  return listFail(hits, str(rule.params?.reason, "Counterparty GSTIN is on the watch list"));
}

function amountOver(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const limit = num(rule.params?.limitPaise, Number.MAX_SAFE_INTEGER);
  const a = A(ci);
  const hits: Hit[] = [];
  for (const d of a.sales) {
    const t = d.lines.reduce((n, l) => n + l.taxable, 0);
    if (t > limit) hits.push({ quote: d.number.trim(), loc: d.loc, text: `sale ${d.number.trim()} taxable ${plainRupees(t)}` });
  }
  for (const p of a.purchases) if (p.booksTaxable > limit) hits.push({ quote: p.number, loc: p.loc, text: `purchase ${p.number} taxable ${plainRupees(p.booksTaxable)}` });
  return listFail(hits, `Documents above ${inr(limit)} need supporting papers on file`);
}

function itcTimeLimit(ci: GstCheckInput, rule: RuleDefinition): CheckOutcome {
  const md = str(rule.params?.deadlineMonthDay, GST_RULE_DEFAULTS.itcDeadlineMonthDay);
  const a = A(ci);
  const filing = ci.extracted.profile.expectedFilingDate ?? a.dueDate;
  const hits: Hit[] = [];
  for (const p of a.purchases) {
    if (p.docType === "CRN" || taxTotal(p.rcm ? p.rcmTax : p.booksTax) <= 0) continue;
    const deadline = dayAfterFyEnd(fyOfDay(p.date), md);
    if (filing > deadline) hits.push({ quote: `${p.number} ${p.date}`, loc: p.loc, text: `${p.number} of ${p.date}: ITC time limit ${deadline} has passed (filing ${filing})` });
  }
  return listFail(hits, `ITC claimed after the s.16(4) time limit`);
}

export const gstRegistry = createRuleRegistry<GstCheckInput>({
  "gst.gstin-valid": gstinValid,
  "gst.2b-missing-in-2b": missingIn2b,
  "gst.2b-missing-in-books": missingInBooks,
  "gst.2b-value-diff": valueDiff,
  "gst.2b-itc-unavailable": itcUnavailable,
  "gst.blocked-credit": blockedCredit,
  "gst.model-questions": modelQuestions,
  "gst.rcm-liability": rcmLiability,
  "gst.hsn-digits": hsnDigits,
  "gst.invoice-duplicates": duplicates,
  "gst.invoice-gaps": gaps,
  "gst.b2cl-threshold": b2cl,
  "gst.credit-note-linked": notesLinked,
  "gst.credit-note-time-limit": noteTimeLimit,
  "gst.pos-tax-type": posTaxType,
  "gst.rule37-180-days": rule37,
  "gst.late-fee-interest": lateness,
  "gst.period-lock": periodLock,
  "gst.einvoice-irn": einvoice,
  "gst.pack-config": packConfig,
  "gst.party-listed": partyListed,
  "gst.amount-over": amountOver,
  "gst.itc-time-limit": itcTimeLimit,
});

// ------------------------------------------------------------------ default pack

export const GST_KEY = "gst";
const verify = (key: string) => GST_VERIFY_NOTES.find((n) => n.key === key)?.verify ?? "";

export const GST_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: GST_KEY,
  version: "1.0.0",
  rules: [
    { id: "gst.gstin-valid", title: "Counterparty GSTINs valid (format, state code, checksum)", severity: "block", kind: "deterministic", check: "gst.gstin-valid", evidence: "the GSTIN and its row" },
    { id: "gst.pos-tax-type", title: "Place of supply matches IGST vs CGST+SGST", severity: "block", kind: "deterministic", check: "gst.pos-tax-type", evidence: "document number, tax heads and row" },
    { id: "gst.rcm-liability", title: "Reverse-charge liability accounted", severity: "block", kind: "deterministic", check: "gst.rcm-liability", evidence: "ledger name and purchase row", params: { verify: verify("rcmRatesBps.legal") } },
    { id: "gst.hsn-digits", title: "HSN digits by aggregate turnover", severity: "block", kind: "deterministic", check: "gst.hsn-digits", evidence: "HSN and sales row", params: { slabs: GST_RULE_DEFAULTS.hsnSlabs, verify: verify("hsnSlabs") } },
    { id: "gst.invoice-duplicates", title: "No duplicate document numbers", severity: "block", kind: "deterministic", check: "gst.invoice-duplicates", evidence: "both document numbers and rows" },
    { id: "gst.credit-note-time-limit", title: "Credit notes within the s.34(2) time limit", severity: "block", kind: "deterministic", check: "gst.credit-note-time-limit", evidence: "note number, date and row", params: { deadlineMonthDay: GST_RULE_DEFAULTS.creditNoteDeadlineMonthDay, verify: verify("creditNoteDeadlineMonthDay") } },
    { id: "gst.period-lock", title: "Previous period GSTR-1 vs GSTR-3B Table 3.1 liability", severity: "block", kind: "deterministic", check: "gst.period-lock", evidence: "tax head figures from the previous return", params: { tolerancePaise: GST_RULE_DEFAULTS.periodLockTolerancePaise, verify: verify("periodLockTolerancePaise") } },
    { id: "gst.einvoice-irn", title: "IRN on B2B documents when e-invoicing applies", severity: "block", kind: "deterministic", check: "gst.einvoice-irn", evidence: "document number and row", params: { aatoPaise: GST_RULE_DEFAULTS.einvoiceAatoPaise, verify: verify("einvoiceAatoPaise") } },
    {
      id: "gst.pack-config",
      title: "SOP pack rates match the GST computation",
      severity: "block",
      kind: "deterministic",
      check: "gst.pack-config",
      evidence: "the parameter, pack value and computation value",
      params: { ...packConfigParams(), verify: GST_VERIFY_NOTES.filter((n) => !["hsnSlabs", "einvoiceAatoPaise", "creditNoteDeadlineMonthDay", "periodLockTolerancePaise", "itcDeadlineMonthDay"].includes(n.key)).map((n) => `${n.key}: ${n.value} — ${n.verify}`) },
    },
    { id: "gst.2b-missing-in-2b", title: "Purchase documents present in GSTR-2B", severity: "warn", kind: "deterministic", check: "gst.2b-missing-in-2b", evidence: "supplier GSTIN, document number and row" },
    { id: "gst.2b-missing-in-books", title: "GSTR-2B documents present in the purchase register", severity: "warn", kind: "deterministic", check: "gst.2b-missing-in-books", evidence: "supplier GSTIN, document number and 2B location" },
    { id: "gst.2b-value-diff", title: "Books vs GSTR-2B value and tax within tolerance", severity: "warn", kind: "deterministic", check: "gst.2b-value-diff", evidence: "document number, both amounts and locations", params: { tolerancePaise: GST_CONFIG.reconTolerancePaise, verify: verify("reconTolerancePaise") } },
    { id: "gst.2b-itc-unavailable", title: "GSTR-2B ITC availability", severity: "warn", kind: "deterministic", check: "gst.2b-itc-unavailable", evidence: "document number and 2B location" },
    { id: "gst.blocked-credit", title: "ITC on blocked credits u/s 17(5)", severity: "warn", kind: "deterministic", check: "gst.blocked-credit", evidence: "ledger name and purchase row" },
    { id: "gst.model-questions", title: "Questions the documents cannot answer (insufficient evidence)", severity: "warn", kind: "deterministic", check: "gst.model-questions", evidence: "the ledger or description and its row" },
    { id: "gst.rule37-180-days", title: "ITC on invoices unpaid beyond 180 days (rule 37)", severity: "warn", kind: "deterministic", check: "gst.rule37-180-days", evidence: "invoice number, date and payables row", params: { days: GST_CONFIG.rule37Days, verify: verify("rule37Days") } },
    { id: "gst.invoice-gaps", title: "Gaps in document series", severity: "warn", kind: "deterministic", check: "gst.invoice-gaps", evidence: "missing numbers and series", params: { maxListed: 20 } },
    { id: "gst.credit-note-linked", title: "Credit/debit notes linked to original invoices", severity: "warn", kind: "deterministic", check: "gst.credit-note-linked", evidence: "note number and row" },
    { id: "gst.late-fee-interest", title: "Late fee and interest exposure", severity: "warn", kind: "deterministic", check: "gst.late-fee-interest", evidence: "expected filing date or previous filing date", params: { verify: [verify("interestRateBps"), verify("lateFee.caps")] } },
    { id: "gst.b2cl-threshold", title: "B2C large (inter-state above threshold) invoices", severity: "info", kind: "deterministic", check: "gst.b2cl-threshold", evidence: "invoice number and row", params: { verify: verify("b2clThresholdPaise") } },
    {
      id: "gst.free-supplies",
      title: "Free supplies, gifts or samples",
      severity: "warn",
      kind: "llm",
      check:
        "Indian GST only; answer from the documents below and nothing else (na when they do not show it). Does any purchase ledger, narration or sales description say the goods or services were given free, as gifts, as free samples, or used for personal consumption (s.17(5)(g)/(h), Schedule I) while ITC is taken or the supply is treated as an ordinary sale?",
      evidence: "the words in the ledger or description and the file row",
    },
  ],
};

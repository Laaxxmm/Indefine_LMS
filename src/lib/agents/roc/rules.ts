// ROC checklist: deterministic rule bodies (registry) and the default SopPack (key "roc",
// version 1.0.0). Bodies read the shared analysis (analyse.ts); thresholds live in data.ts and
// may be overridden per rule through `params` in a later pack. One LLM rule (related-party
// contracts → AOC-2) reads the notes to accounts. Three parameterised checks are registered for
// approved MistakeLog rules only (minimum directors, resident director, s.180 borrowing limit).
import { createRuleRegistry, type ChecklistPack, type CheckOutcome, type RuleDefinition } from "@/lib/agents/core/checklist";
import { formatDayKey, formatInr } from "@/lib/agents/core/format";
import type { CheckInput } from "@/lib/agents/core/runner";
import { analyseRoc, type RocExtract } from "./analyse";
import { MIN_DIRECTORS } from "./data";
import type { RocInput } from "./parse";

export const ROC_KEY = "roc";
export type RocCheckInput = CheckInput<RocInput, RocExtract>;

const inr = (paise: number) => `₹${formatInr(paise / 100)}`;
const day = (k: string | null) => (k ? formatDayKey(k) : "—");
const pass = (message?: string): CheckOutcome => ({ status: "pass", message });
const na = (message: string): CheckOutcome => ({ status: "na", message });
const fail = (message: string, quote: string, location: string): CheckOutcome => ({ status: "fail", message, evidence: { quote, location } });
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isSafeInteger(v) ? v : fallback);

export const rocRegistry = createRuleRegistry<RocCheckInput>({
  "roc.agm-due-date": ({ extracted: x }) => {
    const a = analyseRoc(x);
    if (!a.agm.required) return na("OPC: no AGM is required");
    if (!a.agm.heldOn) return fail(`AGM date not given; the AGM was due by ${day(a.agm.dueDate)}`, "agmDate: null", "company.json agmDate");
    if (a.agm.delayDays > 0)
      return fail(`AGM held ${day(a.agm.heldOn)}, ${a.agm.delayDays} day(s) after the due date ${day(a.agm.dueDate)} (${a.agm.basis})`, `agmDate: ${a.agm.heldOn}`, "company.json agmDate");
    return pass(`AGM held ${day(a.agm.heldOn)}, within ${day(a.agm.dueDate)}`);
  },
  "roc.agm-gap": ({ extracted: x }) => {
    const a = analyseRoc(x);
    if (!a.agm.required || !a.agm.heldOn || !a.agm.gapLimit) return na("no previous AGM date to compare");
    if (a.agm.gapExceeded)
      return fail(`More than 15 months between AGMs: previous ${day(x.company.previousAgmDate)}, this ${day(a.agm.heldOn)} (limit ${day(a.agm.gapLimit)})`, `previousAgmDate: ${x.company.previousAgmDate}`, "company.json previousAgmDate / agmDate");
    return pass();
  },
  "roc.din-kyc": ({ extracted: x }) => {
    const bad = analyseRoc(x).directors.filter((d) => d.issue);
    if (!bad.length) return pass("every director's DIN is active and DIR-3 KYC is done");
    const d = bad[0];
    const row = x.directors.indexOf(x.directors.find((r) => r.din === d.din)!) + 2;
    return fail(`${bad.length} director(s) need action: ${bad.map((b) => `${b.name} (${b.din}): ${b.issue}`).join("; ")}`, `${d.din},${d.name}`, `directors.csv row ${row}`);
  },
  "roc.auditor-term": ({ extracted: x }) => {
    const au = analyseRoc(x).auditor;
    if (au.beyondTerm) return fail(`Auditor ${x.auditor.name} is outside the term: ${au.reason}; a fresh appointment (or reappointment) and ADT-1 are needed`, `termStartFy: ${x.auditor.termStartFy}`, "auditor.json termStartFy");
    if (au.rotationBreached)
      return fail(
        `Rotation (s.139(2)): ${x.auditor.type} auditor at ${au.consecutiveYears} consecutive year(s)${x.auditor.reappointedAtThisAgm ? ` with a further ${x.auditor.termYears}-year reappointment` : ""}; limit ${au.rotationLimit}`,
        `consecutiveYearsBeforeTerm: ${x.auditor.consecutiveYearsBeforeTerm}`,
        "auditor.json",
      );
    return pass(au.reason);
  },
  "roc.adt1-trigger": ({ extracted: x }) => {
    const au = analyseRoc(x).auditor;
    if (au.adt1Missing) return fail(`${au.reason}: put the appointment / reappointment resolution on the AGM agenda and file ADT-1 within 15 days`, `termStartFy: ${x.auditor.termStartFy}`, "auditor.json termStartFy / termYears");
    return pass(au.adt1Required ? "ADT-1 required for the appointment at this AGM (see due dates)" : "no auditor appointment falls due at this AGM");
  },
  "roc.shareholding-ties": ({ extracted: x }) => {
    const s = analyseRoc(x).shareholding;
    if (s.diffPaise !== 0)
      return fail(
        `Shareholding totals ${inr(s.totalPaise)} (${s.totalShares} shares) but paid-up capital is ${inr(x.company.paidUpCapitalPaise)}: difference ${inr(s.diffPaise)}`,
        `paidUpCapital ${formatInr(x.company.paidUpCapitalPaise / 100)}`,
        "shareholding.csv total vs company.json paidUpCapital",
      );
    return pass(`shareholding ${inr(s.totalPaise)} = paid-up capital`);
  },
  "roc.annual-return-form": ({ extracted: x }) => {
    const a = analyseRoc(x);
    const declared = x.company.declaredAnnualReturnForm;
    if (!declared) return pass(`${a.annualReturnForm} applies (${a.small.reason})`);
    if (declared !== a.annualReturnForm)
      return fail(
        `Declared ${declared} but ${a.annualReturnForm} applies: ${a.small.reason} (limits paid-up ${inr(a.small.paidUpMaxPaise)}, turnover ${inr(a.small.turnoverMaxPaise)}; tested turnover ${inr(a.small.turnoverTestedPaise)})`,
        `declaredAnnualReturnForm: ${declared}`,
        "company.json declaredAnnualReturnForm",
      );
    return pass(`${declared} is right (${a.small.reason})`);
  },
  "roc.financials-tie": ({ extracted: x }) => {
    const a = analyseRoc(x);
    const questions = x.financials.ledgerQuestions ?? [];
    if (questions.length)
      return fail(
        `Reviewer question (insufficient evidence): the Schedule III head of ${questions.length} ledger(s) cannot be told from the name — ${questions.join(", ")}. Classify them before the AOC-4 sheet is used.`,
        questions[0],
        "financials.json trialBalance",
      );
    if (x.financials.unmappedLedgers.length)
      return fail(`${x.financials.unmappedLedgers.length} trial-balance ledger(s) were not mapped to a Schedule III head: ${x.financials.unmappedLedgers.join(", ")}`, x.financials.unmappedLedgers[0], "financials.json trialBalance");
    if (a.balanceSheetDiffPaise !== 0)
      return fail(`Balance sheet does not tie: assets ${inr(a.current.assets)} vs equity and liabilities ${inr(a.current.equityAndLiabilities)} (difference ${inr(a.balanceSheetDiffPaise)})`, `assets ${formatInr(a.current.assets / 100)}`, "financials current year");
    if (a.capitalDiffPaise !== 0)
      return fail(`Share capital in the balance sheet ${inr(x.financials.current.shareCapital)} differs from paid-up capital ${inr(x.company.paidUpCapitalPaise)}`, `shareCapital ${formatInr(x.financials.current.shareCapital / 100)}`, "financials current shareCapital");
    return pass("balance sheet ties and share capital agrees");
  },
  "roc.csr-applicability": ({ extracted: x }) => {
    const c = analyseRoc(x).csr;
    if (!c.applicable) return pass("CSR thresholds not met in the preceding year");
    return fail(`CSR applies (${c.reasons.join(", ")} at or above the s.135 threshold): obligation ${inr(c.obligationPaise)} (2% of the ${c.yearsAveraged}-year average net profit ${inr(c.avgNetProfitPaise)}); CSR annexure in the board's report and CSR-2 needed`, `preceding-year ${c.reasons.join(", ")}`, "financials previous year");
  },
  "roc.msme1-applicability": ({ extracted: x }) => {
    const m = analyseRoc(x).msme1;
    if (!m.applicable) return pass("no micro / small supplier dues beyond 45 days");
    const first = [...m.h1, ...m.h2][0];
    const row = x.msme.indexOf(first) + 2;
    return fail(`MSME-1 needed: ${m.h1.length} supplier(s) Apr–Sep and ${m.h2.length} supplier(s) Oct–Mar beyond 45 days`, `${first.vendor},${first.halfYear},${first.daysOutstanding}`, `msme.csv row ${row}`);
  },
  "roc.dpt3-applicability": ({ extracted: x }) => {
    const d = analyseRoc(x).dpt3;
    if (d.exempt) return na("government company: DPT-3 exempt");
    if (!d.applicable) return pass("no deposits or outstanding loans at the FY end");
    if (d.filedOn) return pass(`DPT-3 filed ${day(d.filedOn)}`);
    const dep = x.company.deposits;
    return fail(`DPT-3 return due by 30 June: deposits ${inr(dep.depositsOutstandingPaise)}, money not treated as deposits ${inr(dep.loansNotDepositsPaise)}; not filed`, `loansNotDeposits ${formatInr(dep.loansNotDepositsPaise / 100)}`, "company.json deposits");
  },
  "roc.filing-delay-fee": ({ extracted: x }) => {
    const a = analyseRoc(x);
    if (a.fees.total <= 0) return pass(x.company.estimateFilingOn ? "planned filing date is within every due date" : "no planned filing date: estimate assumes filing by the due dates");
    const lateForms = a.forms.filter((f) => f.additionalFeePaise > 0).map((f) => `${f.form} ${inr(f.additionalFeePaise)}`);
    return fail(`Filing on ${day(x.company.estimateFilingOn)} attracts additional fee ${inr(a.fees.total)}: ${lateForms.join(", ")}`, `estimateFilingOn: ${x.company.estimateFilingOn}`, "company.json estimateFilingOn");
  },

  // ---------------------------------------------------------------- mistake-loop checks
  "roc.min-directors": ({ extracted: x }, rule: RuleDefinition) => {
    const cls = x.company.companyClass;
    const min = num(rule.params?.[cls], MIN_DIRECTORS[cls]);
    const active = x.directors.filter((d) => d.dinStatus === "active").length;
    if (active < min) return fail(`${active} active director(s); a ${cls} company needs at least ${min}`, `${active} active`, "directors.csv");
    return pass();
  },
  "roc.resident-director": ({ extracted: x }) => {
    if (x.directors.some((d) => d.residentInIndia && d.dinStatus === "active")) return pass();
    return fail("No director stayed in India for 182 days or more in the FY (s.149(3))", "resident_in_india: no", "directors.csv");
  },
  "roc.borrowing-limit": ({ extracted: x }, rule: RuleDefinition) => {
    const classes = Array.isArray(rule.params?.classes) ? rule.params.classes.map(String) : ["public"];
    if (!classes.includes(x.company.companyClass)) return na(`${x.company.companyClass} company: not in scope of this check`);
    const a = analyseRoc(x);
    const limit = x.financials.current.shareCapital + x.financials.current.reservesSurplus;
    if (a.current.borrowings > limit)
      return fail(`Borrowings ${inr(a.current.borrowings)} exceed paid-up capital + free reserves ${inr(limit)}: special resolution under s.180(1)(c) and MGT-14 needed`, `borrowings ${formatInr(a.current.borrowings / 100)}`, "financials current year");
    return pass();
  },
});

const d = (id: string, title: string, severity: "block" | "warn" | "info", evidence: string, failMessage?: string): RuleDefinition => ({
  id,
  title,
  severity,
  kind: "deterministic",
  check: id,
  evidence,
  ...(failMessage ? { failMessage } : {}),
});

export const ROC_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: ROC_KEY,
  version: "1.0.0",
  rules: [
    d("roc.agm-due-date", "AGM held within the due date", "block", "AGM date, due date and basis"),
    d("roc.agm-gap", "Not more than 15 months between AGMs", "block", "previous and current AGM dates"),
    d("roc.din-kyc", "Every director's DIN active and DIR-3 KYC done", "block", "DIN, name and row of directors.csv"),
    d("roc.auditor-term", "Auditor within the five-year term and rotation limits", "block", "term start FY, term years and consecutive years"),
    d("roc.shareholding-ties", "Shareholding totals equal paid-up capital", "block", "shareholding total and paid-up capital"),
    d("roc.annual-return-form", "MGT-7 / MGT-7A classification right", "block", "declared form, limits and tested figures"),
    d("roc.financials-tie", "Balance sheet ties and share capital agrees", "block", "assets, equity and liabilities"),
    d("roc.adt1-trigger", "ADT-1 / auditor appointment at this AGM", "warn", "auditor term start and term years"),
    d("roc.csr-applicability", "CSR applicability (s.135)", "warn", "preceding-year net worth, turnover, net profit"),
    d("roc.msme1-applicability", "MSME-1 half-yearly return", "warn", "supplier, half-year and days outstanding"),
    d("roc.dpt3-applicability", "DPT-3 return of deposits / loans", "warn", "deposits and loans outstanding at the FY end"),
    d("roc.filing-delay-fee", "Planned filing attracts additional fee", "warn", "planned filing date and fee per form"),
    {
      id: "roc.aoc2-related-party",
      title: "Related-party contracts disclosed for AOC-2",
      severity: "warn",
      kind: "llm",
      check:
        "Do the notes to accounts describe any contract or arrangement with a related party (director, relative, holding/subsidiary/associate or a firm/company in which a director is interested) that is not stated to be in the ordinary course of business at arm's length, so that Form AOC-2 must be annexed to the board's report?",
      evidence: "the related-party sentence as written in the notes and its line",
    },
  ],
};

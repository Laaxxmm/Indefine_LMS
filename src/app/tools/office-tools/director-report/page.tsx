"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Text, Area, Num, Select, DateInput, ToolShell, inputCls } from "../_components/formkit";

const today = new Date().toISOString().slice(0, 10);

// ---- small helpers for this large form ----
function Toggle({ label, value, onChange, yes = "Yes", no = "No" }: { label: string; value: boolean; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px] font-semibold text-ink-soft">{label}</span>
      <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
        {[[false, no], [true, yes]].map(([v, t]) => (
          <button key={String(v)} type="button" onClick={() => onChange(v as boolean)} className={`px-3 py-1 text-[12px] font-bold transition ${value === v ? "bg-brand-500 text-white" : "bg-card text-ink-mute hover:bg-muted"}`}>{t as string}</button>
        ))}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
      <h3 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3.5">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">{children}</div>;
}

function Repeater<T>({ items, empty, setItems, render, addLabel, min = 0, max = 20 }: { items: T[]; empty: () => T; setItems: (v: T[]) => void; render: (item: T, idx: number, patch: (k: keyof T, v: unknown) => void) => React.ReactNode; addLabel: string; min?: number; max?: number }) {
  const patch = (idx: number, k: keyof T, v: unknown) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, idx) => (
        <div key={idx} className="rounded-xl border border-border p-4 bg-page/40">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-extrabold tracking-wide uppercase text-ink-soft">#{idx + 1}</span>
            {items.length > min && <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-rose-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
          </div>
          <Grid>{render(it, idx, (k, v) => patch(idx, k, v))}</Grid>
        </div>
      ))}
      {items.length < max && (
        <button type="button" onClick={() => setItems([...items, empty()])} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:text-brand-700 self-start">
          <Plus className="w-3.5 h-3.5" /> {addLabel}
        </button>
      )}
    </div>
  );
}

const TABS = ["General", "Financial", "Directors & Meetings", "Key Business Changes", "Compliance & Policies"];

type Member = { name: string; desig: string; meetingsHeld: number | ""; meetingsAttended: number | "" };
const emptyMember = (desig = "Member"): Member => ({ name: "", desig, meetingsHeld: "", meetingsAttended: "" });
const n = (v: number | "") => Number(v) || 0;

export default function DirectorReportPage() {
  const [tab, setTab] = useState(0);
  const full = "sm:col-span-2";

  // General
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyCin, setCompanyCin] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [reportNumber, setReportNumber] = useState("1st First");
  const [financialYear, setFinancialYear] = useState("2024-2025");
  const [previousFinancialYear, setPreviousFinancialYear] = useState("2023-2024");
  const [fyEndDate, setFyEndDate] = useState("2025-03-31");
  const [currentDate, setCurrentDate] = useState(today);
  const [place, setPlace] = useState("MUMBAI (INDIA)");

  // Financial
  const [includePrevYear, setIncludePrevYear] = useState(false);
  const [fin, setFin] = useState({ totalRevenue: 0 as number | "", profitBeforeDepTax: 0 as number | "", depreciation: 0 as number | "", profitBeforeTax: -441108 as number | "", currentTax: 0 as number | "", deferredTax: 0 as number | "", profitForYear: -441108 as number | "" });
  const [prevFin, setPrevFin] = useState({ prevTotalRevenue: 0 as number | "", prevProfitBeforeDepTax: 0 as number | "", prevDepreciation: 0 as number | "", prevProfitBeforeTax: 0 as number | "", prevCurrentTax: 0 as number | "", prevDeferredTax: 0 as number | "", prevProfitForYear: 0 as number | "" });
  const [prevProfit, setPrevProfit] = useState<number | "">(0);

  // Directors
  const [directors, setDirectors] = useState([
    { dinPan: "", name: "", beginDate: today, endDate: "-", category: "Additional Director", meetingsHeld: 5 as number | "", meetingsAttended: 5 as number | "", agmAttendance: "Present" },
    { dinPan: "", name: "", beginDate: today, endDate: "-", category: "Director", meetingsHeld: 5 as number | "", meetingsAttended: 5 as number | "", agmAttendance: "Present" },
  ]);
  const [numBoardMeetings, setNumBoardMeetings] = useState<number | "">(5);
  const [boardMeetingDates, setBoardMeetingDates] = useState("19/06/2024, 12/08/2024, 29/10/2024, 22/12/2024, 03/03/2025");

  // Key business changes
  const [industryChange, setIndustryChange] = useState("Loss");
  const [changeNature, setChangeNature] = useState(false);
  const [newBusinessDesc, setNewBusinessDesc] = useState("");
  const [changeImpact, setChangeImpact] = useState("");
  const [changeRegOffice, setChangeRegOffice] = useState(false);
  const [oldAddress, setOldAddress] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [approvalDetails, setApprovalDetails] = useState("");
  const [regBenefits, setRegBenefits] = useState("");
  const [dividend, setDividend] = useState(false);
  const [div, setDiv] = useState({ interimAmount: 0 as number | "", interimDeclDate: today, interimPayDate: today, interimRationale: "", finalAmount: 0 as number | "", finalPayDate: today });
  const [changeCapital, setChangeCapital] = useState(false);
  const [cap, setCap] = useState({ authCapital: 100000 as number | "", authShares: 10000 as number | "", paidCapital: 100000 as number | "", paidShares: 10000 as number | "", oldAuth: "", newAuth: "", reasonAuth: "", oldPaid: "", newPaid: "", reasonPaid: "", approvalCap: "" });
  const [hasHoldingSub, setHasHoldingSub] = useState(false);
  const [holdings, setHoldings] = useState([{ shareholderName: "", address: "", numShares: 0 as number | "", percentHolding: 0 as number | "" }]);
  const [transferReserves, setTransferReserves] = useState(false);
  const [reserve, setReserve] = useState({ reserveAmount: 0 as number | "", reserveReason: "", reservePurpose: "" });

  // Compliance
  const [hasCommittees, setHasCommittees] = useState(false);
  const [audit, setAudit] = useState({ meetings: 0 as number | "", desc: "", members: [emptyMember("Chairperson"), emptyMember(), emptyMember()] });
  const [nomination, setNomination] = useState({ meetings: 0 as number | "", desc: "", members: [emptyMember("Chairperson"), emptyMember(), emptyMember()] });
  const [stakeholders, setStakeholders] = useState({ meetings: 0 as number | "", desc: "", members: [emptyMember("Chairperson"), emptyMember(), emptyMember()] });
  const [additionalCommittees, setAdditionalCommittees] = useState("");
  const [hasMemberMeetings, setHasMemberMeetings] = useState(false);
  const [memberMeetings, setMemberMeetings] = useState([{ meetingType: "AGM", meetingNumber: "", meetingDate: today, membersPresent: 0 as number | "" }]);
  const [hasLoans, setHasLoans] = useState(false);
  const [loans, setLoans] = useState([{ transType: "Loan", particulars: "", amount: 0 as number | "", purpose: "", approvalDate: today }]);
  const [hasMaterialChanges, setHasMaterialChanges] = useState(false);
  const [material, setMaterial] = useState([{ changeCommit: "", impact: "", dateOcc: today }]);
  const [hasSigOrders, setHasSigOrders] = useState(false);
  const [orders, setOrders] = useState([{ byWhom: "", orderDate: today, details: "", impact: "" }]);
  const [hasRelatedParties, setHasRelatedParties] = useState(false);
  const [related, setRelated] = useState([{ name: "Purple Petal Invest Pvt Ltd", relationship: "Common Director", nature: "Expenses", duration: "NA", terms: "NA", approvalDate: "NA", advance: 303526 as number | "" }]);
  const [hasHighRem, setHasHighRem] = useState(false);
  const [rem, setRem] = useState([{ name: "", desig: "", rem: 0 as number | "" }]);
  const [hasSubChanges, setHasSubChanges] = useState(false);
  const [subs, setSubs] = useState([{ name: "", typeSub: "Subsidiary", changeNature: "Became", changeDate: today }]);
  const [hasDeposits, setHasDeposits] = useState(false);
  const [deposits, setDeposits] = useState([{ depType: "", amountAcc: 0 as number | "", outstanding: 0 as number | "", defaultDetails: "" }]);
  const [hasAudQual, setHasAudQual] = useState(false);
  const [audQuals, setAudQuals] = useState([{ desc: "", response: "", impact: "" }]);
  const [hasFrauds, setHasFrauds] = useState(false);
  const [frauds, setFrauds] = useState([{ nature: "", amount: 0 as number | "", action: "", impact: "" }]);
  const [hasCostAud, setHasCostAud] = useState(false);
  const [costAud, setCostAud] = useState({ name: "", firm: "", regNo: "", period: "", rem: 0 as number | "" });
  const [hasCostRecords, setHasCostRecords] = useState(false);
  const [costRec, setCostRec] = useState({ forProduct: "", compliance: "Compliant", typeRec: "" });
  const [hasIntAud, setHasIntAud] = useState(false);
  const [intAud, setIntAud] = useState({ name: "", firm: "", regNo: "", period: "", rem: 0 as number | "" });
  const [hasPosh, setHasPosh] = useState(false);
  const [posh, setPosh] = useState({ complaintsRec: 0 as number | "", disposed: 0 as number | "", pending: 0 as number | "" });
  const [hasPoshPolicy, setHasPoshPolicy] = useState(false);
  const POSH_CATS = ["Sexual Harassment", "Workplace Discrimination", "Child Labour", "Forced Labour", "Wages and Salary", "Other HR Issues"];
  const [poshComplaints, setPoshComplaints] = useState(POSH_CATS.map(() => ({ received: 0 as number | "", disposedOff: 0 as number | "", pending: 0 as number | "" })));
  const [hasMaternity, setHasMaternity] = useState(false);
  const [maternityReason, setMaternityReason] = useState("Fewer than 10 employees");
  const [hasInsolvency, setHasInsolvency] = useState(false);
  const [insol, setInsol] = useState([{ nature: "", date: today, status: "Pending", court: "", amount: 0 as number | "" }]);
  const [hasOts, setHasOts] = useState(false);
  const [ots, setOts] = useState([{ bank: "", loanAmt: 0 as number | "", valLoan: 0 as number | "", valOts: 0 as number | "", reasonDiff: "" }]);
  const [hasVigil, setHasVigil] = useState(false);
  const [vigil, setVigil] = useState([{ nature: "", rec: 0 as number | "", res: 0 as number | "", pend: 0 as number | "" }]);
  const [hasCsr, setHasCsr] = useState(false);
  const [hasRiskPolicy, setHasRiskPolicy] = useState(false);
  const [risk, setRisk] = useState({ riskMeetings: 0 as number | "", riskKeyAreas: "" });
  const [hasIsin, setHasIsin] = useState(false);
  const [foreignEarnings, setForeignEarnings] = useState<number | "">(0);
  const [foreignOutgo, setForeignOutgo] = useState<number | "">(0);
  const [conservationDetails, setConservationDetails] = useState("As there are no ongoing operations in your Company. Hence there is no need to conserve energy.");
  const [tech, setTech] = useState({ technologyEfforts: "N.A.", technologyBenefits: "N.A.", technologyExpenditure: "N.A.", technologyImported: "N.A.", technologyYear: "N.A.", technologyAbsorbed: "N.A.", technologyNotAbsorbed: "N.A." });

  const mapMembers = (ms: Member[]) => ms.map((m) => ({ name: m.name, desig: m.desig, meetingsHeld: n(m.meetingsHeld), meetingsAttended: n(m.meetingsAttended) }));

  const buildPayload = () => ({
    companyName, companyAddress, companyCin, companyEmail, reportNumber, financialYear, previousFinancialYear, fyEndDate, currentDate, place,
    includePrevYear,
    totalRevenue: n(fin.totalRevenue), profitBeforeDepTax: n(fin.profitBeforeDepTax), depreciation: n(fin.depreciation), profitBeforeTax: n(fin.profitBeforeTax), currentTax: n(fin.currentTax), deferredTax: n(fin.deferredTax), profitForYear: n(fin.profitForYear),
    prevTotalRevenue: n(prevFin.prevTotalRevenue), prevProfitBeforeDepTax: n(prevFin.prevProfitBeforeDepTax), prevDepreciation: n(prevFin.prevDepreciation), prevProfitBeforeTax: n(prevFin.prevProfitBeforeTax), prevCurrentTax: n(prevFin.prevCurrentTax), prevDeferredTax: n(prevFin.prevDeferredTax), prevProfitForYear: n(prevFin.prevProfitForYear),
    prevProfit: n(prevProfit),
    directors: directors.map((x) => ({ dinPan: x.dinPan, name: x.name, beginDate: x.beginDate, endDate: x.endDate, category: x.category, meetingsHeld: n(x.meetingsHeld), meetingsAttended: n(x.meetingsAttended), agmAttendance: x.agmAttendance })),
    numBoardMeetings: n(numBoardMeetings), boardMeetingDates,
    industryChange, changeNature, newBusinessDesc, changeImpact, changeRegOffice, oldAddress, newAddress, approvalDetails, regBenefits,
    dividend, interimAmount: n(div.interimAmount), interimDeclDate: div.interimDeclDate, interimPayDate: div.interimPayDate, interimRationale: div.interimRationale, finalAmount: n(div.finalAmount), finalPayDate: div.finalPayDate,
    changeCapital, authCapital: n(cap.authCapital), authShares: n(cap.authShares), paidCapital: n(cap.paidCapital), paidShares: n(cap.paidShares), oldAuth: cap.oldAuth, newAuth: cap.newAuth, reasonAuth: cap.reasonAuth, oldPaid: cap.oldPaid, newPaid: cap.newPaid, reasonPaid: cap.reasonPaid, approvalCap: cap.approvalCap,
    hasHoldingSub, holdings: holdings.map((h) => ({ shareholderName: h.shareholderName, address: h.address, numShares: n(h.numShares), percentHolding: n(h.percentHolding) })),
    transferReserves, reserveAmount: n(reserve.reserveAmount), reserveReason: reserve.reserveReason, reservePurpose: reserve.reservePurpose,
    hasCommittees,
    audit: { meetings: n(audit.meetings), desc: audit.desc, members: mapMembers(audit.members) },
    nomination: { meetings: n(nomination.meetings), desc: nomination.desc, members: mapMembers(nomination.members) },
    stakeholders: { meetings: n(stakeholders.meetings), desc: stakeholders.desc, members: mapMembers(stakeholders.members) },
    additionalCommittees,
    hasMemberMeetings, memberMeetings: memberMeetings.map((m) => ({ meetingType: m.meetingType, meetingNumber: m.meetingNumber, meetingDate: m.meetingDate, membersPresent: n(m.membersPresent) })),
    hasLoans, loans: loans.map((l) => ({ transType: l.transType, particulars: l.particulars, amount: n(l.amount), purpose: l.purpose, approvalDate: l.approvalDate })),
    hasMaterialChanges, material,
    hasSigOrders, orders,
    hasRelatedParties, related: related.map((r) => ({ name: r.name, relationship: r.relationship, nature: r.nature, duration: r.duration, terms: r.terms, approvalDate: r.approvalDate, advance: n(r.advance) })),
    hasHighRem, rem: rem.map((e) => ({ name: e.name, desig: e.desig, rem: n(e.rem) })),
    hasSubChanges, subs,
    hasDeposits, deposits: deposits.map((dp) => ({ depType: dp.depType, amountAcc: n(dp.amountAcc), outstanding: n(dp.outstanding), defaultDetails: dp.defaultDetails })),
    hasAudQual, audQuals,
    hasFrauds, frauds: frauds.map((fr) => ({ nature: fr.nature, amount: n(fr.amount), action: fr.action, impact: fr.impact })),
    hasCostAud, costAud: { ...costAud, rem: n(costAud.rem) },
    hasCostRecords, costRec,
    hasIntAud, intAud: { ...intAud, rem: n(intAud.rem) },
    hasPosh, posh: { complaintsRec: n(posh.complaintsRec), disposed: n(posh.disposed), pending: n(posh.pending) },
    hasPoshPolicy, poshComplaints: poshComplaints.map((p) => ({ received: n(p.received), disposedOff: n(p.disposedOff), pending: n(p.pending) })),
    hasMaternity, maternityReason,
    hasInsolvency, insol: insol.map((x) => ({ nature: x.nature, date: x.date, status: x.status, court: x.court, amount: n(x.amount) })),
    hasOts, ots: ots.map((o) => ({ bank: o.bank, loanAmt: n(o.loanAmt), valLoan: n(o.valLoan), valOts: n(o.valOts), reasonDiff: o.reasonDiff })),
    hasVigil, vigil: vigil.map((v) => ({ nature: v.nature, rec: n(v.rec), res: n(v.res), pend: n(v.pend) })),
    hasCsr, hasRiskPolicy, riskMeetings: n(risk.riskMeetings), riskKeyAreas: risk.riskKeyAreas, hasIsin,
    foreignEarnings: n(foreignEarnings), foreignOutgo: n(foreignOutgo), conservationDetails, ...tech,
  });

  return (
    <ToolShell tool="director-report" title="Director's Report" subtitle="Generate a company Director's Report (.docx) — plus an AOC-2 annexure when there are related-party transactions." buildPayload={buildPayload}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map((t, i) => (
          <button key={t} type="button" onClick={() => setTab(i)} className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold transition ${tab === i ? "bg-brand-500 text-white shadow-pop" : "bg-card border border-border text-ink-mute hover:bg-muted"}`}>{t}</button>
        ))}
      </div>

      {tab === 0 && (
        <Card title="General company information">
          <Grid>
            <Field label="Company name" required><Text value={companyName} onChange={setCompanyName} /></Field>
            <Field label="CIN"><Text value={companyCin} onChange={setCompanyCin} /></Field>
            <div className={full}><Field label="Company address"><Text value={companyAddress} onChange={setCompanyAddress} /></Field></div>
            <Field label="Email ID"><Text value={companyEmail} onChange={setCompanyEmail} /></Field>
            <Field label="Report number" hint="e.g. 1st First"><Text value={reportNumber} onChange={setReportNumber} /></Field>
            <Field label="Financial year"><Text value={financialYear} onChange={setFinancialYear} /></Field>
            <Field label="Previous financial year"><Text value={previousFinancialYear} onChange={setPreviousFinancialYear} /></Field>
            <Field label="Financial year end date"><DateInput value={fyEndDate} onChange={setFyEndDate} /></Field>
            <Field label="Report date"><DateInput value={currentDate} onChange={setCurrentDate} /></Field>
            <Field label="Place"><Text value={place} onChange={setPlace} /></Field>
          </Grid>
        </Card>
      )}

      {tab === 1 && (
        <Card title="Financial summary (Amount in Rs.)">
          <div className="mb-3"><Toggle label="Include previous year column" value={includePrevYear} onChange={setIncludePrevYear} /></div>
          <Grid>
            {([["Total Revenue", "totalRevenue"], ["Profit/Loss before Depreciation and Tax", "profitBeforeDepTax"], ["Depreciation", "depreciation"], ["Profit/Loss before Tax", "profitBeforeTax"], ["Current Year Tax", "currentTax"], ["Deferred Tax", "deferredTax"], ["Profit/Loss for the Year", "profitForYear"]] as const).map(([lbl, key]) => (
              <Field key={key} label={`${lbl} (${financialYear})`}><Num value={fin[key]} onChange={(v) => setFin({ ...fin, [key]: v })} /></Field>
            ))}
            <Field label="Previous Year Profit/Loss (for industry scenario)"><Num value={prevProfit} onChange={setPrevProfit} /></Field>
          </Grid>
          {includePrevYear && (
            <div className="mt-4">
              <h4 className="text-[11px] font-bold text-ink-mute mb-2">Previous year ({previousFinancialYear})</h4>
              <Grid>
                {([["Total Revenue", "prevTotalRevenue"], ["Profit/Loss before Depreciation and Tax", "prevProfitBeforeDepTax"], ["Depreciation", "prevDepreciation"], ["Profit/Loss before Tax", "prevProfitBeforeTax"], ["Current Year Tax", "prevCurrentTax"], ["Deferred Tax", "prevDeferredTax"], ["Profit/Loss for the Year", "prevProfitForYear"]] as const).map(([lbl, key]) => (
                  <Field key={key} label={lbl}><Num value={prevFin[key]} onChange={(v) => setPrevFin({ ...prevFin, [key]: v })} /></Field>
                ))}
              </Grid>
            </div>
          )}
        </Card>
      )}

      {tab === 2 && (
        <>
          <Card title="Directors">
            <Repeater items={directors} min={1} max={10} addLabel="Add director" setItems={setDirectors} empty={() => ({ dinPan: "", name: "", beginDate: today, endDate: "-", category: "Director", meetingsHeld: "" as number | "", meetingsAttended: "" as number | "", agmAttendance: "Present" })}
              render={(d, i, patch) => (<>
                <Field label="DIN/PAN"><Text value={d.dinPan} onChange={(v) => patch("dinPan", v)} /></Field>
                <Field label="Name"><Text value={d.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="Begin date"><DateInput value={d.beginDate} onChange={(v) => patch("beginDate", v)} /></Field>
                <Field label="End date" hint="e.g. - or a date"><Text value={d.endDate} onChange={(v) => patch("endDate", v)} /></Field>
                <Field label="Category"><Text value={d.category} onChange={(v) => patch("category", v)} /></Field>
                <Field label="Last AGM attendance"><select className={inputCls} value={d.agmAttendance} onChange={(e) => patch("agmAttendance", e.target.value)}><option>Present</option><option>Absent</option></select></Field>
                <Field label="Meetings held"><Num value={d.meetingsHeld} onChange={(v) => patch("meetingsHeld", v)} /></Field>
                <Field label="Meetings attended"><Num value={d.meetingsAttended} onChange={(v) => patch("meetingsAttended", v)} /></Field>
              </>)}
            />
          </Card>
          <Card title="Board meetings">
            <Grid>
              <Field label="Number of board meetings"><Num value={numBoardMeetings} onChange={setNumBoardMeetings} /></Field>
              <div className={full}><Field label="Board meeting dates" hint="comma-separated"><Area value={boardMeetingDates} onChange={setBoardMeetingDates} rows={2} /></Field></div>
            </Grid>
          </Card>
        </>
      )}

      {tab === 3 && (
        <>
          <Card title="Industry scenario">
            <Field label="Current year result"><Select value={industryChange} onChange={setIndustryChange} options={["Loss", "Profit"]} /></Field>
          </Card>
          <Card title="Change in nature of business">
            <Toggle label="Change in nature of business?" value={changeNature} onChange={setChangeNature} />
            {changeNature && <Grid><div className={full}><Field label="Description of new business"><Area value={newBusinessDesc} onChange={setNewBusinessDesc} rows={2} /></Field></div><div className={full}><Field label="Impact or growth from the change"><Area value={changeImpact} onChange={setChangeImpact} rows={2} /></Field></div></Grid>}
          </Card>
          <Card title="Change in registered office">
            <Toggle label="Change in registered office?" value={changeRegOffice} onChange={setChangeRegOffice} />
            {changeRegOffice && <Grid><Field label="Old address"><Text value={oldAddress} onChange={setOldAddress} /></Field><Field label="New address"><Text value={newAddress} onChange={setNewAddress} /></Field><div className={full}><Field label="Statutory requirements / approvals"><Area value={approvalDetails} onChange={setApprovalDetails} rows={2} /></Field></div><div className={full}><Field label="Benefits of relocation"><Area value={regBenefits} onChange={setRegBenefits} rows={2} /></Field></div></Grid>}
          </Card>
          <Card title="Dividend">
            <Toggle label="Recommend dividend?" value={dividend} onChange={setDividend} />
            {dividend && <Grid>
              <Field label="Interim dividend / share"><Num value={div.interimAmount} onChange={(v) => setDiv({ ...div, interimAmount: v })} /></Field>
              <Field label="Interim declaration date"><DateInput value={div.interimDeclDate} onChange={(v) => setDiv({ ...div, interimDeclDate: v })} /></Field>
              <Field label="Interim payment date"><DateInput value={div.interimPayDate} onChange={(v) => setDiv({ ...div, interimPayDate: v })} /></Field>
              <Field label="Final dividend / share"><Num value={div.finalAmount} onChange={(v) => setDiv({ ...div, finalAmount: v })} /></Field>
              <Field label="Final payment date"><DateInput value={div.finalPayDate} onChange={(v) => setDiv({ ...div, finalPayDate: v })} /></Field>
              <div className={full}><Field label="Rationale for interim dividend"><Area value={div.interimRationale} onChange={(v) => setDiv({ ...div, interimRationale: v })} rows={2} /></Field></div>
            </Grid>}
          </Card>
          <Card title="Capital structure">
            <Grid>
              <Field label="Authorized share capital (Rs.)"><Num value={cap.authCapital} onChange={(v) => setCap({ ...cap, authCapital: v })} /></Field>
              <Field label="Authorized shares"><Num value={cap.authShares} onChange={(v) => setCap({ ...cap, authShares: v })} /></Field>
              <Field label="Paid-up share capital (Rs.)"><Num value={cap.paidCapital} onChange={(v) => setCap({ ...cap, paidCapital: v })} /></Field>
              <Field label="Paid-up shares"><Num value={cap.paidShares} onChange={(v) => setCap({ ...cap, paidShares: v })} /></Field>
            </Grid>
            <div className="mt-3"><Toggle label="Change in capital structure?" value={changeCapital} onChange={setChangeCapital} /></div>
            {changeCapital && <Grid>
              <Field label="Old authorized capital"><Text value={cap.oldAuth} onChange={(v) => setCap({ ...cap, oldAuth: v })} /></Field>
              <Field label="New authorized capital"><Text value={cap.newAuth} onChange={(v) => setCap({ ...cap, newAuth: v })} /></Field>
              <div className={full}><Field label="Reason for authorized change"><Area value={cap.reasonAuth} onChange={(v) => setCap({ ...cap, reasonAuth: v })} rows={2} /></Field></div>
              <Field label="Old paid-up capital"><Text value={cap.oldPaid} onChange={(v) => setCap({ ...cap, oldPaid: v })} /></Field>
              <Field label="New paid-up capital"><Text value={cap.newPaid} onChange={(v) => setCap({ ...cap, newPaid: v })} /></Field>
              <div className={full}><Field label="Reason for paid-up change"><Area value={cap.reasonPaid} onChange={(v) => setCap({ ...cap, reasonPaid: v })} rows={2} /></Field></div>
              <div className={full}><Field label="Approval details for capital change"><Area value={cap.approvalCap} onChange={(v) => setCap({ ...cap, approvalCap: v })} rows={2} /></Field></div>
            </Grid>}
          </Card>
          <Card title="Holding / subsidiary / associate">
            <Toggle label="Has holding/subsidiary/associate?" value={hasHoldingSub} onChange={setHasHoldingSub} />
            {hasHoldingSub && <div className="mt-2"><Repeater items={holdings} addLabel="Add company" setItems={setHoldings} empty={() => ({ shareholderName: "", address: "", numShares: "" as number | "", percentHolding: "" as number | "" })}
              render={(h, i, patch) => (<>
                <Field label="Shareholder name"><Text value={h.shareholderName} onChange={(v) => patch("shareholderName", v)} /></Field>
                <Field label="Address"><Text value={h.address} onChange={(v) => patch("address", v)} /></Field>
                <Field label="Number of shares"><Num value={h.numShares} onChange={(v) => patch("numShares", v)} /></Field>
                <Field label="% holding"><Num value={h.percentHolding} onChange={(v) => patch("percentHolding", v)} /></Field>
              </>)} /></div>}
          </Card>
          <Card title="Transfer to reserves">
            <Toggle label="Transfer to reserves?" value={transferReserves} onChange={setTransferReserves} />
            {transferReserves && <Grid>
              <Field label="Reserve amount"><Num value={reserve.reserveAmount} onChange={(v) => setReserve({ ...reserve, reserveAmount: v })} /></Field>
              <div /><div className={full}><Field label="Reason for transfer"><Area value={reserve.reserveReason} onChange={(v) => setReserve({ ...reserve, reserveReason: v })} rows={2} /></Field></div>
              <div className={full}><Field label="Purpose of reserves"><Area value={reserve.reservePurpose} onChange={(v) => setReserve({ ...reserve, reservePurpose: v })} rows={2} /></Field></div>
            </Grid>}
          </Card>
        </>
      )}

      {tab === 4 && (
        <>
          <Card title="Committees">
            <Toggle label="Has committees?" value={hasCommittees} onChange={setHasCommittees} />
            {hasCommittees && ([["Audit Committee", audit, setAudit], ["Nomination & Remuneration Committee", nomination, setNomination], ["Stakeholders' Relationship Committee", stakeholders, setStakeholders]] as const).map(([title, cm, setCm]) => (
              <div key={title} className="mt-4">
                <h4 className="text-[12px] font-bold text-ink-soft mb-2">{title}</h4>
                <Grid>
                  <Field label="Meetings held"><Num value={cm.meetings} onChange={(v) => setCm({ ...cm, meetings: v })} /></Field>
                  <div /><div className={full}><Field label="Key discussions"><Area value={cm.desc} onChange={(v) => setCm({ ...cm, desc: v })} rows={2} /></Field></div>
                </Grid>
                <div className="mt-2"><Repeater items={cm.members} addLabel="Add member" setItems={(v) => setCm({ ...cm, members: v })} empty={() => emptyMember()}
                  render={(m, i, patch) => (<>
                    <Field label="Name"><Text value={m.name} onChange={(v) => patch("name", v)} /></Field>
                    <Field label="Designation"><Text value={m.desig} onChange={(v) => patch("desig", v)} /></Field>
                    <Field label="Meetings held"><Num value={m.meetingsHeld} onChange={(v) => patch("meetingsHeld", v)} /></Field>
                    <Field label="Meetings attended"><Num value={m.meetingsAttended} onChange={(v) => patch("meetingsAttended", v)} /></Field>
                  </>)} /></div>
              </div>
            ))}
            {hasCommittees && <div className="mt-3"><Field label="Additional committees"><Area value={additionalCommittees} onChange={setAdditionalCommittees} rows={2} /></Field></div>}
          </Card>

          <Card title="Meetings of members">
            <Toggle label="Meetings of members?" value={hasMemberMeetings} onChange={setHasMemberMeetings} />
            {hasMemberMeetings && <div className="mt-2"><Repeater items={memberMeetings} addLabel="Add meeting" setItems={setMemberMeetings} empty={() => ({ meetingType: "AGM", meetingNumber: "", meetingDate: today, membersPresent: "" as number | "" })}
              render={(m, i, patch) => (<>
                <Field label="Meeting type"><select className={inputCls} value={m.meetingType} onChange={(e) => patch("meetingType", e.target.value)}><option>AGM</option><option>EGM</option></select></Field>
                <Field label="Meeting number"><Text value={m.meetingNumber} onChange={(v) => patch("meetingNumber", v)} /></Field>
                <Field label="Date"><DateInput value={m.meetingDate} onChange={(v) => patch("meetingDate", v)} /></Field>
                <Field label="Members present"><Num value={m.membersPresent} onChange={(v) => patch("membersPresent", v)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="Loans, guarantees or investments (S.186)">
            <Toggle label="Loans, guarantees or investments?" value={hasLoans} onChange={setHasLoans} />
            {hasLoans && <div className="mt-2"><Repeater items={loans} addLabel="Add transaction" setItems={setLoans} empty={() => ({ transType: "Loan", particulars: "", amount: "" as number | "", purpose: "", approvalDate: today })}
              render={(l, i, patch) => (<>
                <Field label="Type"><select className={inputCls} value={l.transType} onChange={(e) => patch("transType", e.target.value)}><option>Loan</option><option>Guarantee</option><option>Investment</option></select></Field>
                <Field label="Particulars"><Text value={l.particulars} onChange={(v) => patch("particulars", v)} /></Field>
                <Field label="Amount (Rs.)"><Num value={l.amount} onChange={(v) => patch("amount", v)} /></Field>
                <Field label="Approval date"><DateInput value={l.approvalDate} onChange={(v) => patch("approvalDate", v)} /></Field>
                <div className={full}><Field label="Purpose"><Area value={l.purpose} onChange={(v) => patch("purpose", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Material changes">
            <Toggle label="Material changes?" value={hasMaterialChanges} onChange={setHasMaterialChanges} />
            {hasMaterialChanges && <div className="mt-2"><Repeater items={material} addLabel="Add change" setItems={setMaterial} empty={() => ({ changeCommit: "", impact: "", dateOcc: today })}
              render={(m, i, patch) => (<>
                <div className={full}><Field label="Change / commitment"><Area value={m.changeCommit} onChange={(v) => patch("changeCommit", v)} rows={2} /></Field></div>
                <div className={full}><Field label="Impact on financial position"><Area value={m.impact} onChange={(v) => patch("impact", v)} rows={2} /></Field></div>
                <Field label="Date of occurrence"><DateInput value={m.dateOcc} onChange={(v) => patch("dateOcc", v)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="Significant orders">
            <Toggle label="Significant orders?" value={hasSigOrders} onChange={setHasSigOrders} />
            {hasSigOrders && <div className="mt-2"><Repeater items={orders} addLabel="Add order" setItems={setOrders} empty={() => ({ byWhom: "", orderDate: today, details: "", impact: "" })}
              render={(o, i, patch) => (<>
                <Field label="Order passed by"><Text value={o.byWhom} onChange={(v) => patch("byWhom", v)} /></Field>
                <Field label="Date of order"><DateInput value={o.orderDate} onChange={(v) => patch("orderDate", v)} /></Field>
                <div className={full}><Field label="Details of order"><Area value={o.details} onChange={(v) => patch("details", v)} rows={2} /></Field></div>
                <div className={full}><Field label="Impact on future operations"><Area value={o.impact} onChange={(v) => patch("impact", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Related party transactions">
            <Toggle label="Related party transactions?" value={hasRelatedParties} onChange={setHasRelatedParties} />
            {hasRelatedParties && <div className="mt-2"><Repeater items={related} addLabel="Add related party" setItems={setRelated} empty={() => ({ name: "", relationship: "", nature: "", duration: "NA", terms: "NA", approvalDate: "NA", advance: 0 as number | "" })}
              render={(r, i, patch) => (<>
                <Field label="Name of related party"><Text value={r.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="Nature of relationship"><Text value={r.relationship} onChange={(v) => patch("relationship", v)} /></Field>
                <Field label="Nature of transaction"><Text value={r.nature} onChange={(v) => patch("nature", v)} /></Field>
                <Field label="Duration"><Text value={r.duration} onChange={(v) => patch("duration", v)} /></Field>
                <Field label="Terms"><Text value={r.terms} onChange={(v) => patch("terms", v)} /></Field>
                <Field label="Date(s) of Board approval"><Text value={r.approvalDate} onChange={(v) => patch("approvalDate", v)} /></Field>
                <Field label="Amount paid as advances"><Num value={r.advance} onChange={(v) => patch("advance", v)} /></Field>
              </>)} /></div>}
            <p className="text-[11px] text-ink-faint mt-2">When enabled, an AOC-2 annexure is appended to the report.</p>
          </Card>

          <Card title="High remuneration employees">
            <Toggle label="High remuneration employees?" value={hasHighRem} onChange={setHasHighRem} />
            {hasHighRem && <div className="mt-2"><Repeater items={rem} addLabel="Add employee" setItems={setRem} empty={() => ({ name: "", desig: "", rem: "" as number | "" })}
              render={(e, i, patch) => (<>
                <Field label="Name"><Text value={e.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="Designation"><Text value={e.desig} onChange={(v) => patch("desig", v)} /></Field>
                <Field label="Remuneration (Rs.)"><Num value={e.rem} onChange={(v) => patch("rem", v)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="Subsidiary / JV / associate changes">
            <Toggle label="Subsidiary changes?" value={hasSubChanges} onChange={setHasSubChanges} />
            {hasSubChanges && <div className="mt-2"><Repeater items={subs} addLabel="Add change" setItems={setSubs} empty={() => ({ name: "", typeSub: "Subsidiary", changeNature: "Became", changeDate: today })}
              render={(s, i, patch) => (<>
                <Field label="Company name"><Text value={s.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="Type"><select className={inputCls} value={s.typeSub} onChange={(e) => patch("typeSub", e.target.value)}><option>Subsidiary</option><option>Joint Venture</option><option>Associate</option></select></Field>
                <Field label="Nature of change"><select className={inputCls} value={s.changeNature} onChange={(e) => patch("changeNature", e.target.value)}><option>Became</option><option>Ceased</option></select></Field>
                <Field label="Date of change"><DateInput value={s.changeDate} onChange={(v) => patch("changeDate", v)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="Deposits">
            <Toggle label="Accepted deposits?" value={hasDeposits} onChange={setHasDeposits} />
            {hasDeposits && <div className="mt-2"><Repeater items={deposits} addLabel="Add deposit" setItems={setDeposits} empty={() => ({ depType: "", amountAcc: "" as number | "", outstanding: "" as number | "", defaultDetails: "" })}
              render={(dp, i, patch) => (<>
                <Field label="Type of deposit"><Text value={dp.depType} onChange={(v) => patch("depType", v)} /></Field>
                <Field label="Amount accepted (Rs.)"><Num value={dp.amountAcc} onChange={(v) => patch("amountAcc", v)} /></Field>
                <Field label="Total outstanding (Rs.)"><Num value={dp.outstanding} onChange={(v) => patch("outstanding", v)} /></Field>
                <div className={full}><Field label="Details of any default"><Area value={dp.defaultDetails} onChange={(v) => patch("defaultDetails", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Auditors' report qualifications">
            <Toggle label="Auditors' qualifications?" value={hasAudQual} onChange={setHasAudQual} />
            {hasAudQual && <div className="mt-2"><Repeater items={audQuals} addLabel="Add qualification" setItems={setAudQuals} empty={() => ({ desc: "", response: "", impact: "" })}
              render={(q, i, patch) => (<>
                <div className={full}><Field label="Qualification / reservation / adverse remark"><Area value={q.desc} onChange={(v) => patch("desc", v)} rows={2} /></Field></div>
                <div className={full}><Field label="Management's response"><Area value={q.response} onChange={(v) => patch("response", v)} rows={2} /></Field></div>
                <div className={full}><Field label="Impact on financial statements"><Area value={q.impact} onChange={(v) => patch("impact", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Frauds reported">
            <Toggle label="Frauds reported?" value={hasFrauds} onChange={setHasFrauds} />
            {hasFrauds && <div className="mt-2"><Repeater items={frauds} addLabel="Add fraud" setItems={setFrauds} empty={() => ({ nature: "", amount: "" as number | "", action: "", impact: "" })}
              render={(fr, i, patch) => (<>
                <div className={full}><Field label="Nature of fraud"><Area value={fr.nature} onChange={(v) => patch("nature", v)} rows={2} /></Field></div>
                <Field label="Amount involved (Rs.)"><Num value={fr.amount} onChange={(v) => patch("amount", v)} /></Field>
                <div /><div className={full}><Field label="Action taken"><Area value={fr.action} onChange={(v) => patch("action", v)} rows={2} /></Field></div>
                <div className={full}><Field label="Impact on financial statements"><Area value={fr.impact} onChange={(v) => patch("impact", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Cost auditor">
            <Toggle label="Cost auditor required?" value={hasCostAud} onChange={setHasCostAud} />
            {hasCostAud && <Grid>
              <Field label="Name"><Text value={costAud.name} onChange={(v) => setCostAud({ ...costAud, name: v })} /></Field>
              <Field label="Firm name"><Text value={costAud.firm} onChange={(v) => setCostAud({ ...costAud, firm: v })} /></Field>
              <Field label="Registration no."><Text value={costAud.regNo} onChange={(v) => setCostAud({ ...costAud, regNo: v })} /></Field>
              <Field label="Period of appointment"><Text value={costAud.period} onChange={(v) => setCostAud({ ...costAud, period: v })} /></Field>
              <Field label="Remuneration"><Num value={costAud.rem} onChange={(v) => setCostAud({ ...costAud, rem: v })} /></Field>
            </Grid>}
          </Card>

          <Card title="Cost records">
            <Toggle label="Maintain cost records?" value={hasCostRecords} onChange={setHasCostRecords} />
            {hasCostRecords && <Grid>
              <Field label="Cost records maintained for"><Text value={costRec.forProduct} onChange={(v) => setCostRec({ ...costRec, forProduct: v })} /></Field>
              <Field label="Compliance"><select className={inputCls} value={costRec.compliance} onChange={(e) => setCostRec({ ...costRec, compliance: e.target.value })}><option>Compliant</option><option>Non-Compliant</option></select></Field>
              <Field label="Type of records maintained"><Text value={costRec.typeRec} onChange={(v) => setCostRec({ ...costRec, typeRec: v })} /></Field>
            </Grid>}
          </Card>

          <Card title="Internal auditor">
            <Toggle label="Internal auditor required?" value={hasIntAud} onChange={setHasIntAud} />
            {hasIntAud && <Grid>
              <Field label="Name"><Text value={intAud.name} onChange={(v) => setIntAud({ ...intAud, name: v })} /></Field>
              <Field label="Firm name"><Text value={intAud.firm} onChange={(v) => setIntAud({ ...intAud, firm: v })} /></Field>
              <Field label="Registration no."><Text value={intAud.regNo} onChange={(v) => setIntAud({ ...intAud, regNo: v })} /></Field>
              <Field label="Period of appointment"><Text value={intAud.period} onChange={(v) => setIntAud({ ...intAud, period: v })} /></Field>
              <Field label="Remuneration"><Num value={intAud.rem} onChange={(v) => setIntAud({ ...intAud, rem: v })} /></Field>
            </Grid>}
          </Card>

          <Card title="Sexual harassment (ICC)">
            <Toggle label="POSH applicable (ICC)?" value={hasPosh} onChange={setHasPosh} />
            {hasPosh && <Grid>
              <Field label="Complaints received"><Num value={posh.complaintsRec} onChange={(v) => setPosh({ ...posh, complaintsRec: v })} /></Field>
              <Field label="Complaints disposed of"><Num value={posh.disposed} onChange={(v) => setPosh({ ...posh, disposed: v })} /></Field>
              <Field label="Complaints pending"><Num value={posh.pending} onChange={(v) => setPosh({ ...posh, pending: v })} /></Field>
            </Grid>}
          </Card>

          <Card title="PoSH policy (complaints summary)">
            <Toggle label="Has PoSH policy?" value={hasPoshPolicy} onChange={setHasPoshPolicy} />
            {hasPoshPolicy && <div className="mt-2 flex flex-col gap-2">
              {POSH_CATS.map((cat, idx) => (
                <div key={cat} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[12px]">
                  <span className="font-semibold text-ink-soft">{cat}</span>
                  {(["received", "disposedOff", "pending"] as const).map((k) => (
                    <input key={k} type="number" placeholder={k} className={`${inputCls} w-20`} value={poshComplaints[idx][k]} onChange={(e) => setPoshComplaints(poshComplaints.map((p, i) => (i === idx ? { ...p, [k]: e.target.value === "" ? "" : Number(e.target.value) } : p)))} />
                  ))}
                </div>
              ))}
            </div>}
          </Card>

          <Card title="Maternity benefit">
            <Toggle label="Maternity benefit applicable?" value={hasMaternity} onChange={setHasMaternity} />
            {!hasMaternity && <div className="mt-2"><Field label="Reason for not applicable"><Select value={maternityReason} onChange={setMaternityReason} options={["Fewer than 10 employees", "No female employees"]} /></Field></div>}
          </Card>

          <Card title="Insolvency proceedings">
            <Toggle label="Insolvency proceedings?" value={hasInsolvency} onChange={setHasInsolvency} />
            {hasInsolvency && <div className="mt-2"><Repeater items={insol} addLabel="Add proceeding" setItems={setInsol} empty={() => ({ nature: "", date: today, status: "Pending", court: "", amount: "" as number | "" })}
              render={(x, i, patch) => (<>
                <div className={full}><Field label="Nature of proceedings"><Area value={x.nature} onChange={(v) => patch("nature", v)} rows={2} /></Field></div>
                <Field label="Date"><DateInput value={x.date} onChange={(v) => patch("date", v)} /></Field>
                <Field label="Status"><select className={inputCls} value={x.status} onChange={(e) => patch("status", e.target.value)}><option>Pending</option><option>Disposed</option></select></Field>
                <Field label="Court / tribunal"><Text value={x.court} onChange={(v) => patch("court", v)} /></Field>
                <Field label="Amount involved"><Num value={x.amount} onChange={(v) => patch("amount", v)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="One-time settlement">
            <Toggle label="One-time settlement?" value={hasOts} onChange={setHasOts} />
            {hasOts && <div className="mt-2"><Repeater items={ots} addLabel="Add settlement" setItems={setOts} empty={() => ({ bank: "", loanAmt: "" as number | "", valLoan: "" as number | "", valOts: "" as number | "", reasonDiff: "" })}
              render={(o, i, patch) => (<>
                <Field label="Bank / financial institution"><Text value={o.bank} onChange={(v) => patch("bank", v)} /></Field>
                <Field label="Loan amount availed (Rs.)"><Num value={o.loanAmt} onChange={(v) => patch("loanAmt", v)} /></Field>
                <Field label="Valuation during loan (Rs.)"><Num value={o.valLoan} onChange={(v) => patch("valLoan", v)} /></Field>
                <Field label="Valuation during OTS (Rs.)"><Num value={o.valOts} onChange={(v) => patch("valOts", v)} /></Field>
                <div className={full}><Field label="Reasons for valuation difference"><Area value={o.reasonDiff} onChange={(v) => patch("reasonDiff", v)} rows={2} /></Field></div>
              </>)} /></div>}
          </Card>

          <Card title="Vigil mechanism">
            <Toggle label="Vigil mechanism applicable?" value={hasVigil} onChange={setHasVigil} />
            {hasVigil && <div className="mt-2"><Repeater items={vigil} addLabel="Add concern" setItems={setVigil} empty={() => ({ nature: "", rec: "" as number | "", res: "" as number | "", pend: "" as number | "" })}
              render={(v, i, patch) => (<>
                <div className={full}><Field label="Nature of concern"><Area value={v.nature} onChange={(val) => patch("nature", val)} rows={2} /></Field></div>
                <Field label="Complaints received"><Num value={v.rec} onChange={(val) => patch("rec", val)} /></Field>
                <Field label="Complaints resolved"><Num value={v.res} onChange={(val) => patch("res", val)} /></Field>
                <Field label="Pending complaints"><Num value={v.pend} onChange={(val) => patch("pend", val)} /></Field>
              </>)} /></div>}
          </Card>

          <Card title="Other policies & disclosures">
            <div className="flex flex-col gap-1.5">
              <Toggle label="CSR applicable?" value={hasCsr} onChange={setHasCsr} />
              <Toggle label="Risk management policy?" value={hasRiskPolicy} onChange={setHasRiskPolicy} />
              {hasRiskPolicy && <Grid>
                <Field label="Risk committee meetings"><Num value={risk.riskMeetings} onChange={(v) => setRisk({ ...risk, riskMeetings: v })} /></Field>
                <div /><div className={full}><Field label="Key risk areas & mitigation"><Area value={risk.riskKeyAreas} onChange={(v) => setRisk({ ...risk, riskKeyAreas: v })} rows={2} /></Field></div>
              </Grid>}
              <Toggle label="Obtain ISIN required?" value={hasIsin} onChange={setHasIsin} />
            </div>
          </Card>

          <Card title="Foreign exchange, energy & technology">
            <Grid>
              <Field label="Foreign exchange earnings"><Num value={foreignEarnings} onChange={setForeignEarnings} /></Field>
              <Field label="Foreign exchange outgo"><Num value={foreignOutgo} onChange={setForeignOutgo} /></Field>
              <div className={full}><Field label="Conservation of energy details"><Area value={conservationDetails} onChange={setConservationDetails} rows={2} /></Field></div>
              {([["Efforts made for technology absorption", "technologyEfforts"], ["Benefits derived", "technologyBenefits"], ["Expenditure on R&D", "technologyExpenditure"], ["Details of technology imported", "technologyImported"], ["Year of import", "technologyYear"], ["Whether imported technology fully absorbed", "technologyAbsorbed"], ["Areas not absorbed", "technologyNotAbsorbed"]] as const).map(([lbl, key]) => (
                <Field key={key} label={lbl}><Text value={tech[key]} onChange={(v) => setTech({ ...tech, [key]: v })} /></Field>
              ))}
            </Grid>
          </Card>
        </>
      )}
    </ToolShell>
  );
}

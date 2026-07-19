"use client";

import { useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Field, Text, Area, Num, Select, DateInput, Section, ToolShell, inputCls } from "../_components/formkit";
import { TRUST_TYPES, DESIGNATIONS, SHORT_OBJECTS, DETAILED_OBJECTS } from "./presets";

const today = new Date().toISOString().slice(0, 10);

type Party = { name: string; aadhaar: string; pan: string; age: number | ""; address: string; designation: string };
const emptyParty = (): Party => ({ name: "", aadhaar: "", pan: "", age: "", address: "", designation: DESIGNATIONS[0] });

export default function TrustPage() {
  const [dateExecution, setDateExecution] = useState(today);
  const [trustType, setTrustType] = useState(TRUST_TYPES[0]);
  const [shortObjects, setShortObjects] = useState(SHORT_OBJECTS[TRUST_TYPES[0]]);
  const [detailedObjects, setDetailedObjects] = useState(DETAILED_OBJECTS[TRUST_TYPES[0]]);
  const [amountDeclared, setAmountDeclared] = useState<number | "">(500);
  const [trustName, setTrustName] = useState("");
  const [trustAddress, setTrustAddress] = useState("");

  const [parties, setParties] = useState<Party[]>([emptyParty(), emptyParty()]);
  const [boardTrustees, setBoardTrustees] = useState("");
  const [officers, setOfficers] = useState("");
  const [signatures, setSignatures] = useState("");

  const [w1Name, setW1Name] = useState("");
  const [w1Address, setW1Address] = useState("");
  const [w1Phone, setW1Phone] = useState("");
  const [w2Name, setW2Name] = useState("");
  const [w2Address, setW2Address] = useState("");
  const [w2Phone, setW2Phone] = useState("");

  const onType = (v: string) => {
    setTrustType(v);
    setShortObjects(SHORT_OBJECTS[v] ?? "");
    setDetailedObjects(DETAILED_OBJECTS[v] ?? "");
  };

  const patch = (idx: number, key: keyof Party, val: string | number) =>
    setParties((ps) => ps.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  const addParty = () => setParties((ps) => (ps.length < 15 ? [...ps, emptyParty()] : ps));
  const removeParty = (idx: number) => setParties((ps) => (ps.length > 2 ? ps.filter((_, i) => i !== idx) : ps));

  const fillFromParties = () => {
    setBoardTrustees(parties.map((p) => `${p.name}, ${p.designation}`).join("\n"));
    setOfficers(parties.map((p) => p.designation).join("\n"));
    setSignatures(parties.map((p) => `${p.name}\n${p.designation}\nPAN: ${p.pan}\nAADHAAR: ${p.aadhaar}`).join("\n\n"));
  };

  const full = "sm:col-span-2";

  const buildPayload = () => ({
    dateExecution, shortObjects, detailedObjects,
    amountDeclared: Number(amountDeclared) || 0,
    trustName, trustAddress,
    parties: parties.map((p) => ({ name: p.name, aadhaar: p.aadhaar, pan: p.pan, age: Number(p.age) || 0, address: p.address, designation: p.designation })),
    boardTrustees, officers, signatures,
    witnesses: `1. ${w1Name}\n${w1Address}\n${w1Phone}\n\n2. ${w2Name}\n${w2Address}\n${w2Phone}`,
  });

  return (
    <ToolShell tool="trust" title="Trust Deed" subtitle="Generate a Deed of Declaration of Trust (.docx). Pick a trust type to auto-fill the objects, then edit as needed." buildPayload={buildPayload}>
      <Section title="Basic info">
        <Field label="Date of execution" required><DateInput value={dateExecution} onChange={setDateExecution} /></Field>
        <Field label="Type of trust" required><Select value={trustType} onChange={onType} options={TRUST_TYPES} /></Field>
        <Field label="Amount declared (₹)" required><Num value={amountDeclared} onChange={setAmountDeclared} min={1} /></Field>
        <Field label="Name of trust" required><Text value={trustName} onChange={setTrustName} /></Field>
        <div className={full}><Field label="Address of trust" required><Area value={trustAddress} onChange={setTrustAddress} rows={2} /></Field></div>
        <div className={full}><Field label="Short objects (2 paragraphs)" required><Area value={shortObjects} onChange={setShortObjects} rows={4} /></Field></div>
        <div className={full}><Field label="Detailed objects (15–20 points)" required><Area value={detailedObjects} onChange={setDetailedObjects} rows={10} /></Field></div>
      </Section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">Trustees / Parties ({parties.length})</h2>
          <button type="button" onClick={addParty} disabled={parties.length >= 15} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:text-brand-700 disabled:text-ink-faint">
            <Plus className="w-3.5 h-3.5" /> Add party
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {parties.map((p, idx) => (
            <div key={idx} className="rounded-xl border border-border p-4 bg-page/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-extrabold tracking-wide uppercase text-ink-soft">Party {idx + 1}</span>
                {parties.length > 2 && <button type="button" onClick={() => removeParty(idx)} aria-label={`Remove party ${idx + 1}`} className="text-rose-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Name" required><Text value={p.name} onChange={(v) => patch(idx, "name", v)} /></Field>
                <Field label="Age" required><Num value={p.age} onChange={(v) => patch(idx, "age", v === "" ? "" : v)} min={18} /></Field>
                <Field label="Aadhaar no." required><Text value={p.aadhaar} onChange={(v) => patch(idx, "aadhaar", v)} /></Field>
                <Field label="PAN" required><Text value={p.pan} onChange={(v) => patch(idx, "pan", v)} /></Field>
                <Field label="Designation" required>
                  <select className={inputCls} value={p.designation} onChange={(e) => patch(idx, "designation", e.target.value)}>
                    {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <div />
                <div className={full}><Field label="Address" required><Area value={p.address} onChange={(v) => patch(idx, "address", v)} rows={2} /></Field></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">Board, officers & signatures</h2>
          <button type="button" onClick={fillFromParties} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:text-brand-700">
            <Wand2 className="w-3.5 h-3.5" /> Fill from parties
          </button>
        </div>
        <div className="grid gap-y-3.5">
          <Field label="First Board of Trustees — names" required hint="one per line"><Area value={boardTrustees} onChange={setBoardTrustees} rows={3} /></Field>
          <Field label="Officers of the trust" required hint="one designation per line"><Area value={officers} onChange={setOfficers} rows={3} /></Field>
          <Field label="Signatures block" required hint="name / designation / PAN / Aadhaar per party"><Area value={signatures} onChange={setSignatures} rows={6} /></Field>
        </div>
      </section>

      <Section title="Witnesses">
        <Field label="Witness 1 — name" required><Text value={w1Name} onChange={setW1Name} /></Field>
        <Field label="Witness 1 — phone"><Text value={w1Phone} onChange={setW1Phone} /></Field>
        <div className={full}><Field label="Witness 1 — address" required><Area value={w1Address} onChange={setW1Address} rows={2} /></Field></div>
        <Field label="Witness 2 — name" required><Text value={w2Name} onChange={setW2Name} /></Field>
        <Field label="Witness 2 — phone"><Text value={w2Phone} onChange={setW2Phone} /></Field>
        <div className={full}><Field label="Witness 2 — address" required><Area value={w2Address} onChange={setW2Address} rows={2} /></Field></div>
      </Section>
    </ToolShell>
  );
}

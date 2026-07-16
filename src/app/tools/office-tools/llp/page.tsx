"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Text, Area, Num, Select, Section, ToolShell, inputCls } from "../_components/formkit";

const BUSINESS_TYPES = ["Cloud chain", "Real estate", "IT consultancy", "Trading", "Healthcare", "Financial services", "Human Resource management", "Coworking space", "Education", "Toys", "Clothing"];

type Partner = { name: string; gender: string; father: string; age: number | ""; pan: string; din: string; address: string; role: string; contribution: number | ""; profitShare: number | "" };
const emptyPartner = (): Partner => ({ name: "", gender: "Son", father: "", age: "", pan: "", din: "", address: "", role: "New", contribution: "", profitShare: "" });

export default function LlpPage() {
  const [llpType, setLlpType] = useState("Reconstitution");
  const [llpName, setLlpName] = useState("");
  const [state, setState] = useState("");
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [partners, setPartners] = useState<Partner[]>([emptyPartner(), emptyPartner(), emptyPartner()]);

  const patch = (idx: number, key: keyof Partner, val: string | number) =>
    setPartners((ps) => ps.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  const addPartner = () => setPartners((ps) => (ps.length < 5 ? [...ps, emptyPartner()] : ps));
  const removePartner = (idx: number) => setPartners((ps) => (ps.length > 2 ? ps.filter((_, i) => i !== idx) : ps));

  const full = "sm:col-span-2";

  const buildPayload = () => ({
    llpType, llpName, state, businessType,
    partners: partners.map((p) => ({
      name: p.name, gender: p.gender, father: p.father, age: Number(p.age) || 0,
      pan: p.pan.toUpperCase(), din: p.din || "N/A", address: p.address,
      role: llpType === "New LLP" ? "New" : p.role,
      contribution: Number(p.contribution) || 0, profitShare: Number(p.profitShare) || 0,
    })),
  });

  return (
    <ToolShell tool="llp" title="LLP Agreement" subtitle="Generate a Limited Liability Partnership agreement (.docx) with e-stamp space. Profit shares must total 100%." buildPayload={buildPayload}>
      <Section title="Basic info">
        <Field label="LLP type" required><Select value={llpType} onChange={setLlpType} options={["Reconstitution", "New LLP"]} /></Field>
        <Field label="Business type" required><Select value={businessType} onChange={setBusinessType} options={BUSINESS_TYPES} /></Field>
        <Field label="LLP name" required><Text value={llpName} onChange={setLlpName} /></Field>
        <Field label="Registered office state" required><Text value={state} onChange={setState} /></Field>
      </Section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">Partners ({partners.length})</h2>
          <button type="button" onClick={addPartner} disabled={partners.length >= 5} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:text-brand-700 disabled:text-ink-faint">
            <Plus className="w-3.5 h-3.5" /> Add partner
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {partners.map((p, idx) => (
            <div key={idx} className="rounded-xl border border-border p-4 bg-page/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-extrabold tracking-wide uppercase text-ink-soft">Partner {idx + 1}</span>
                {partners.length > 2 && <button type="button" onClick={() => removePartner(idx)} className="text-rose-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Full name" required hint="e.g. Mr. John Doe"><Text value={p.name} onChange={(v) => patch(idx, "name", v)} /></Field>
                <Field label="Age" required><Num value={p.age} onChange={(v) => patch(idx, "age", v === "" ? "" : v)} min={18} /></Field>
                <Field label="Son / Daughter of" required>
                  <select className={inputCls} value={p.gender} onChange={(e) => patch(idx, "gender", e.target.value)}>
                    <option value="Son">Son</option>
                    <option value="Daughter">Daughter</option>
                  </select>
                </Field>
                <Field label="Father / guardian name" required><Text value={p.father} onChange={(v) => patch(idx, "father", v)} /></Field>
                <Field label="PAN" required hint="ABCDE1234F"><Text value={p.pan} onChange={(v) => patch(idx, "pan", v)} /></Field>
                <Field label="DIN (optional)"><Text value={p.din} onChange={(v) => patch(idx, "din", v)} /></Field>
                <div className={full}><Field label="Full address" required><Area value={p.address} onChange={(v) => patch(idx, "address", v)} rows={2} /></Field></div>
                {llpType === "Reconstitution" && (
                  <Field label="Partner type" required>
                    <select className={inputCls} value={p.role} onChange={(e) => patch(idx, "role", e.target.value)}>
                      <option value="Continuing">Continuing</option>
                      <option value="New">New</option>
                      <option value="Resigning">Resigning</option>
                    </select>
                  </Field>
                )}
                {llpType === "Reconstitution" ? <div /> : null}
                <Field label="Contribution (₹)" required><Num value={p.contribution} onChange={(v) => patch(idx, "contribution", v === "" ? "" : v)} min={1} /></Field>
                <Field label="Profit share (%)" required><Num value={p.profitShare} onChange={(v) => patch(idx, "profitShare", v === "" ? "" : v)} min={0} /></Field>
              </div>
            </div>
          ))}
        </div>
      </section>
    </ToolShell>
  );
}

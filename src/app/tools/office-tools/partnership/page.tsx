"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Text, Area, Num, Select, DateInput, Section, ToolShell, inputCls } from "../_components/formkit";

const today = new Date().toISOString().slice(0, 10);

const BUSINESS_TYPES = ["Cloud chain", "Real estate", "IT consultancy", "Trading", "Healthcare", "Financial services", "Human Resource management", "Coworking space", "Education", "Toys", "Clothing"];

const SHORT_OBJECTS: Record<string, string> = {
  "Cloud chain": "cloud chain management and related services and any other business as mutually agreed by all the partners from time to time.",
  "Real estate": "real estate development and management and any other business as mutually agreed by all the partners from time to time.",
  "IT consultancy": "IT consultancy and related services and any other business as mutually agreed by all the partners from time to time.",
  "Trading": "trading of goods and related services and any other business as mutually agreed by all the partners from time to time.",
  "Healthcare": "healthcare services and any other business as mutually agreed by all the partners from time to time.",
  "Financial services": "financial services and any other business as mutually agreed by all the partners from time to time.",
  "Human Resource management": "human resource management and related services and any other business as mutually agreed by all the partners from time to time.",
  "Coworking space": "coworking space management and related services and any other business as mutually agreed by all the partners from time to time.",
  "Education": "educational services and any other business as mutually agreed by all the partners from time to time.",
  "Toys": "trading of toys and related products and any other business as mutually agreed by all the partners from time to time.",
  "Clothing": "trading of clothing and related products and any other business as mutually agreed by all the partners from time to time.",
};

const BUSINESS_ACTIVITY: Record<string, string> = {
  "Cloud chain": "The partnership shall engage in cloud-based supply chain management, including development of software for logistics optimization, inventory tracking, and supply chain analytics. This includes consulting services for implementing cloud solutions in supply chains. (HSN code: 998314 for IT services related to cloud computing). The business may expand to related technology services as agreed.\n\nThis business involves leveraging cloud technologies to streamline supply chains, reduce costs, and improve efficiency for clients across various industries. Partners will focus on innovative solutions and may collaborate with tech providers.",
  "Real estate": "The partnership shall carry on the business of real estate development, including acquisition, construction, sale, and rental of residential and commercial properties. This encompasses property management and brokerage services. (HSN code: 9972 for real estate services). Additional real estate related activities may be undertaken as mutually agreed.\n\nThe firm will engage in buying, developing, and selling properties, as well as providing leasing and maintenance services. Focus on sustainable development and market analysis to maximize returns.",
  "IT consultancy": "The partnership shall provide IT consultancy services, including software development, system integration, cybersecurity advice, and digital transformation consulting. (HSN code: 9983 for management consulting and IT services). The firm may also offer training and maintenance services in IT. Expansion to related tech areas as decided by partners.\n\nServices will include advising clients on IT strategies, implementing custom software solutions, and ensuring data security. The business aims to help organizations optimize their technology infrastructure.",
  "Trading": "The partnership shall engage in general trading activities, including wholesale and retail of various goods, import/export operations, and e-commerce trading. (HSN code: Varies by product, e.g., 99 for services). The business will focus on efficient supply chain and may include value-added services. Other trading opportunities may be pursued as agreed.\n\nActivities involve sourcing, storing, and distributing goods, with emphasis on market trends and customer needs. The firm may specialize in specific product categories as business evolves.",
  "Healthcare": "The partnership shall provide healthcare services, including operation of clinics, diagnostic centers, telemedicine, and health consulting. (HSN code: 9993 for human health services). This may include medical equipment supply and wellness programs. Expansion to allied health services as mutually decided.\n\nThe business will focus on delivering quality medical care, preventive health services, and patient education. Partners will ensure compliance with health regulations and adopt modern technologies.",
  "Financial services": "The partnership shall offer financial services including advisory, investment management, loan facilitation, and accounting services. (HSN code: 9971 for financial services). The firm may also provide insurance brokerage and fintech solutions. Other financial products as agreed by partners.\n\nServices encompass financial planning, tax consulting, and wealth management for individuals and businesses. Emphasis on ethical practices and client-centric approaches.",
  "Human Resource management": "The partnership shall provide human resource management services, including recruitment, training, payroll processing, and HR consulting. (HSN code: 9985 for support services). This includes talent management and organizational development. Expansion to related business services as decided.\n\nThe firm will assist companies in talent acquisition, employee development, and HR compliance. Focus on innovative HR solutions to enhance workforce productivity.",
  "Coworking space": "The partnership shall operate coworking spaces, providing shared office facilities, virtual offices, and business support services. (HSN code: 9972 for real estate services including rental). This may include event hosting and networking events. Other workspace solutions as mutually agreed.\n\nActivities involve managing flexible workspaces, fostering community, and providing amenities. The business aims to support startups, freelancers, and remote workers.",
  "Education": "The partnership shall provide educational services, including running coaching centers, online courses, skill development programs, and educational consulting. (HSN code: 9992 for education services). The business may expand to e-learning platforms and vocational training. Additional educational initiatives as agreed.\n\nServices will cover various subjects and levels, with emphasis on quality teaching and student outcomes. Incorporate technology for interactive learning experiences.",
  "Toys": "The partnership shall engage in manufacturing, trading, and retail of toys and games, including import/export and online sales. (HSN code: 9503 for toys). This includes educational toys and accessories. The business may expand to related children's products as mutually decided.\n\nFocus on safe, innovative toys that promote learning and play. Activities include product design, sourcing, and marketing to various channels.",
  "Clothing": "The partnership shall operate in the clothing industry, including manufacturing, trading, and retail of apparel, fashion design, and e-commerce sales. (HSN code: 61-62 for clothing). This encompasses textiles and accessories. Expansion to related fashion items as agreed by partners.\n\nThe firm will create and sell trendy, quality clothing for various demographics. Emphasis on sustainable materials and efficient supply chain.",
};

const ORD = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

type Partner = { name: string; aadhaar: string; pan: string; age: number | ""; relationType: string; relationName: string; address: string; capital: number | ""; profitShare: number | "" };
const emptyPartner = (): Partner => ({ name: "", aadhaar: "", pan: "", age: "", relationType: "s/o", relationName: "", address: "", capital: "", profitShare: "" });

export default function PartnershipPage() {
  const [dateExecution, setDateExecution] = useState(today);
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [shortObjects, setShortObjects] = useState(SHORT_OBJECTS[BUSINESS_TYPES[0]]);
  const [businessActivity, setBusinessActivity] = useState(BUSINESS_ACTIVITY[BUSINESS_TYPES[0]]);
  const [partnershipName, setPartnershipName] = useState("");
  const [placeBusiness, setPlaceBusiness] = useState("");

  const [partners, setPartners] = useState<Partner[]>([emptyPartner(), emptyPartner()]);
  const [remuneration, setRemuneration] = useState<number | "">(25000);
  const [drawingsLimit, setDrawingsLimit] = useState("5,00,000");
  const [managingPartnerIdx, setManagingPartnerIdx] = useState(0);
  const [bankOperatorIdx, setBankOperatorIdx] = useState(0);

  const [witness1Name, setWitness1Name] = useState("");
  const [witness1Address, setWitness1Address] = useState("");
  const [witness2Name, setWitness2Name] = useState("");
  const [witness2Address, setWitness2Address] = useState("");

  const onBusinessType = (v: string) => {
    setBusinessType(v);
    setShortObjects(SHORT_OBJECTS[v] ?? "");
    setBusinessActivity(BUSINESS_ACTIVITY[v] ?? "");
  };

  const patch = (idx: number, key: keyof Partner, val: string | number) =>
    setPartners((ps) => ps.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  const addPartner = () => setPartners((ps) => (ps.length < 10 ? [...ps, emptyPartner()] : ps));
  const removePartner = (idx: number) =>
    setPartners((ps) => {
      if (ps.length <= 2) return ps;
      const next = ps.filter((_, i) => i !== idx);
      if (managingPartnerIdx >= next.length) setManagingPartnerIdx(next.length - 1);
      if (bankOperatorIdx >= next.length) setBankOperatorIdx(next.length - 1);
      return next;
    });

  const full = "sm:col-span-2";

  const buildPayload = () => ({
    dateExecution, businessType, shortObjects, businessActivity, partnershipName, placeBusiness,
    partners: partners.map((p) => ({
      name: p.name, aadhaar: p.aadhaar, pan: p.pan.toUpperCase(), age: Number(p.age) || 0,
      relationType: p.relationType, relationName: p.relationName, address: p.address,
      capital: Number(p.capital) || 0, profitShare: Number(p.profitShare) || 0,
    })),
    remuneration: Number(remuneration) || 0,
    drawingsLimit,
    managingPartnerIdx, bankOperatorIdx,
    witness1Name, witness1Address, witness2Name, witness2Address,
  });

  return (
    <ToolShell tool="partnership" title="Partnership Deed" subtitle="Generate a partnership deed and Form 1 registration (combined .docx). Profit shares must total 100%." buildPayload={buildPayload}>
      <Section title="Basic info">
        <Field label="Date of agreement" required><DateInput value={dateExecution} onChange={setDateExecution} /></Field>
        <Field label="Type of business" required><Select value={businessType} onChange={onBusinessType} options={BUSINESS_TYPES} /></Field>
        <Field label="Name of partnership" required><Text value={partnershipName} onChange={setPartnershipName} /></Field>
        <div className={full}><Field label="Place of business" required><Area value={placeBusiness} onChange={setPlaceBusiness} rows={2} /></Field></div>
        <div className={full}><Field label="WHEREAS — objects in short" required><Area value={shortObjects} onChange={setShortObjects} rows={3} /></Field></div>
        <div className={full}><Field label="Business activity of partnership" required><Area value={businessActivity} onChange={setBusinessActivity} rows={5} /></Field></div>
      </Section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">Partners ({partners.length})</h2>
          <button type="button" onClick={addPartner} disabled={partners.length >= 10} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:text-brand-700 disabled:text-ink-faint">
            <Plus className="w-3.5 h-3.5" /> Add partner
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {partners.map((p, idx) => (
            <div key={idx} className="rounded-xl border border-border p-4 bg-page/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-extrabold tracking-wide uppercase text-ink-soft">{ORD[idx]} Partner</span>
                {partners.length > 2 && (
                  <button type="button" onClick={() => removePartner(idx)} className="text-rose-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Name" required><Text value={p.name} onChange={(v) => patch(idx, "name", v)} /></Field>
                <Field label="Age" required><Num value={p.age} onChange={(v) => patch(idx, "age", v === "" ? "" : v)} min={18} /></Field>
                <Field label="Aadhaar no." required hint="12 digits"><Text value={p.aadhaar} onChange={(v) => patch(idx, "aadhaar", v)} /></Field>
                <Field label="PAN" required hint="ABCDE1234F"><Text value={p.pan} onChange={(v) => patch(idx, "pan", v)} /></Field>
                <Field label="Relation" required>
                  <select className={inputCls} value={p.relationType} onChange={(e) => patch(idx, "relationType", e.target.value)}>
                    <option value="s/o">Son of (S/O)</option>
                    <option value="d/o">Daughter of (D/O)</option>
                    <option value="w/o">Wife of (W/O)</option>
                    <option value="h/o">Husband of (H/O)</option>
                  </select>
                </Field>
                <Field label="Father/Spouse/Guardian name" required><Text value={p.relationName} onChange={(v) => patch(idx, "relationName", v)} /></Field>
                <div className={full}><Field label="Address" required><Area value={p.address} onChange={(v) => patch(idx, "address", v)} rows={2} /></Field></div>
                <Field label="Capital contribution (₹)" required><Num value={p.capital} onChange={(v) => patch(idx, "capital", v === "" ? "" : v)} min={0} step={1000} /></Field>
                <Field label="Profit share (%)" required><Num value={p.profitShare} onChange={(v) => patch(idx, "profitShare", v === "" ? "" : v)} min={0} /></Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Section title="Other details">
        <Field label="Remuneration per month (₹)" required><Num value={remuneration} onChange={setRemuneration} min={0} step={1000} /></Field>
        <Field label="Limit on drawings per annum (₹)" required><Text value={drawingsLimit} onChange={setDrawingsLimit} /></Field>
        <Field label="Managing partner" required>
          <select className={inputCls} value={managingPartnerIdx} onChange={(e) => setManagingPartnerIdx(Number(e.target.value))}>
            {partners.map((p, i) => <option key={i} value={i}>{ORD[i]} Partner{p.name ? ` — ${p.name}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Bank account operator" required>
          <select className={inputCls} value={bankOperatorIdx} onChange={(e) => setBankOperatorIdx(Number(e.target.value))}>
            {partners.map((p, i) => <option key={i} value={i}>{ORD[i]} Partner{p.name ? ` — ${p.name}` : ""}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Witnesses">
        <Field label="Witness 1 — name" required><Text value={witness1Name} onChange={setWitness1Name} /></Field>
        <div />
        <div className={full}><Field label="Witness 1 — address" required><Area value={witness1Address} onChange={setWitness1Address} rows={2} /></Field></div>
        <Field label="Witness 2 — name" required><Text value={witness2Name} onChange={setWitness2Name} /></Field>
        <div />
        <div className={full}><Field label="Witness 2 — address" required><Area value={witness2Address} onChange={setWitness2Address} rows={2} /></Field></div>
      </Section>
    </ToolShell>
  );
}

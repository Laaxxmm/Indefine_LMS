"use client";

import { useState } from "react";
import { Field, Text, Area, Num, Select, DateInput, Section, ToolShell } from "../_components/formkit";

const today = new Date().toISOString().slice(0, 10);

export default function MouPage() {
  const [agreementDate, setAgreementDate] = useState(today);
  const [party1Name, setParty1Name] = useState("Company A");
  const [party1Address, setParty1Address] = useState("");
  const [party1Short, setParty1Short] = useState("First Party");
  const [party2Name, setParty2Name] = useState("Company B");
  const [party2Address, setParty2Address] = useState("");
  const [party2Short, setParty2Short] = useState("Second Party");

  const [projectTitle, setProjectTitle] = useState("");
  const [objectives, setObjectives] = useState("");
  const [businessType, setBusinessType] = useState("");

  const [scopeParty1, setScopeParty1] = useState("");
  const [scopeParty2, setScopeParty2] = useState("");
  const [rolesParty1, setRolesParty1] = useState("");
  const [rolesParty2, setRolesParty2] = useState("");

  const [governanceCompany, setGovernanceCompany] = useState("");
  const [ipOwner, setIpOwner] = useState("First Party");
  const [commercializationParty, setCommercializationParty] = useState("First Party");
  const [validityYears, setValidityYears] = useState<number | "">(3);
  const [courtLocation, setCourtLocation] = useState("");

  const [sig1Name, setSig1Name] = useState("");
  const [sig1Designation, setSig1Designation] = useState("");
  const [sig1AuthDoc, setSig1AuthDoc] = useState("");
  const [sig1AuthDate, setSig1AuthDate] = useState(today);
  const [sig2Name, setSig2Name] = useState("");
  const [sig2Designation, setSig2Designation] = useState("");
  const [sig2AuthDoc, setSig2AuthDoc] = useState("");
  const [sig2AuthDate, setSig2AuthDate] = useState(today);

  const [witness1Name, setWitness1Name] = useState("");
  const [witness1Address, setWitness1Address] = useState("");
  const [witness2Name, setWitness2Name] = useState("");
  const [witness2Address, setWitness2Address] = useState("");

  const shortOpts = [party1Short, party2Short];
  const full = "sm:col-span-2";

  const buildPayload = () => ({
    agreementDate,
    party1Name, party1Address, party1Short,
    party2Name, party2Address, party2Short,
    projectTitle, objectives, businessType,
    scopeParty1, scopeParty2, rolesParty1, rolesParty2,
    governanceCompany, ipOwner, commercializationParty,
    validityYears: Number(validityYears) || 0,
    courtLocation,
    sig1Name, sig1Designation, sig1AuthDoc, sig1AuthDate,
    sig2Name, sig2Designation, sig2AuthDoc, sig2AuthDate,
    witness1Name, witness1Address, witness2Name, witness2Address,
  });

  return (
    <ToolShell tool="mou" title="MOU Generator" subtitle="Generate a Memorandum of Understanding (.docx) between two parties, with e-stamp space at the top." buildPayload={buildPayload}>
      <Section title="Date & parties">
        <Field label="Agreement date" required><DateInput value={agreementDate} onChange={setAgreementDate} /></Field>
        <div />
        <Field label="Party 1 — company name" required><Text value={party1Name} onChange={setParty1Name} /></Field>
        <Field label="Party 1 — short name" required><Text value={party1Short} onChange={setParty1Short} /></Field>
        <div className={full}><Field label="Party 1 — registered office address" required><Area value={party1Address} onChange={setParty1Address} rows={2} /></Field></div>
        <Field label="Party 2 — company name" required><Text value={party2Name} onChange={setParty2Name} /></Field>
        <Field label="Party 2 — short name" required><Text value={party2Short} onChange={setParty2Short} /></Field>
        <div className={full}><Field label="Party 2 — registered office address" required><Area value={party2Address} onChange={setParty2Address} rows={2} /></Field></div>
      </Section>

      <Section title="Project & objectives">
        <div className={full}><Field label="Project title" required><Text value={projectTitle} onChange={setProjectTitle} /></Field></div>
        <div className={full}><Field label="Objectives" required hint="one per line"><Area value={objectives} onChange={setObjectives} rows={4} /></Field></div>
        <Field label="Business type" required hint="e.g. business / restaurant"><Text value={businessType} onChange={setBusinessType} /></Field>
      </Section>

      <Section title="Scope & roles">
        <div className={full}><Field label="Scope of work — Party 1" required hint="one per line"><Area value={scopeParty1} onChange={setScopeParty1} rows={3} /></Field></div>
        <div className={full}><Field label="Scope of work — Party 2" required hint="one per line"><Area value={scopeParty2} onChange={setScopeParty2} rows={3} /></Field></div>
        <div className={full}><Field label="Roles & responsibilities — Party 1" required hint="one per line"><Area value={rolesParty1} onChange={setRolesParty1} rows={3} /></Field></div>
        <div className={full}><Field label="Roles & responsibilities — Party 2" required hint="one per line"><Area value={rolesParty2} onChange={setRolesParty2} rows={3} /></Field></div>
      </Section>

      <Section title="Other clauses">
        <Field label="Governance company name" required><Text value={governanceCompany} onChange={setGovernanceCompany} /></Field>
        <Field label="Validity (years)" required><Num value={validityYears} onChange={setValidityYears} min={1} /></Field>
        <Field label="IP owner" required><Select value={ipOwner} onChange={setIpOwner} options={shortOpts} /></Field>
        <Field label="Commercialization rights party" required><Select value={commercializationParty} onChange={setCommercializationParty} options={shortOpts} /></Field>
        <Field label="Court location" required><Text value={courtLocation} onChange={setCourtLocation} /></Field>
      </Section>

      <Section title="Signatures">
        <Field label="Party 1 — signatory name" required><Text value={sig1Name} onChange={setSig1Name} /></Field>
        <Field label="Party 1 — designation" required><Text value={sig1Designation} onChange={setSig1Designation} /></Field>
        <Field label="Party 1 — authorization doc no." required><Text value={sig1AuthDoc} onChange={setSig1AuthDoc} /></Field>
        <Field label="Party 1 — authorization date" required><DateInput value={sig1AuthDate} onChange={setSig1AuthDate} /></Field>
        <Field label="Party 2 — signatory name" required><Text value={sig2Name} onChange={setSig2Name} /></Field>
        <Field label="Party 2 — designation" required><Text value={sig2Designation} onChange={setSig2Designation} /></Field>
        <Field label="Party 2 — authorization doc no." required><Text value={sig2AuthDoc} onChange={setSig2AuthDoc} /></Field>
        <Field label="Party 2 — authorization date" required><DateInput value={sig2AuthDate} onChange={setSig2AuthDate} /></Field>
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

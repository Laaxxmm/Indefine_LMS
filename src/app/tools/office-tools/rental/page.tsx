"use client";

import { useState } from "react";
import { Field, Text, Area, Num, Select, DateInput, Section, ToolShell } from "../_components/formkit";

const today = new Date().toISOString().slice(0, 10);

export default function RentalPage() {
  const [place, setPlace] = useState("Bangalore");
  const [agreementDate, setAgreementDate] = useState(today);
  const [premisesType, setPremisesType] = useState("Residential");
  const [businessName, setBusinessName] = useState("");

  const [ownerName, setOwnerName] = useState("");
  const [ownerFather, setOwnerFather] = useState("");
  const [ownerAadhaar, setOwnerAadhaar] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantFather, setTenantFather] = useState("");
  const [tenantAadhaar, setTenantAadhaar] = useState("");
  const [tenantAddress, setTenantAddress] = useState("");

  const [securityDeposit, setSecurityDeposit] = useState<number | "">(100000);
  const [rent, setRent] = useState<number | "">(10000);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [otherChargesTitle, setOtherChargesTitle] = useState("WATER AND ELECTRICITY");
  const [otherCharges, setOtherCharges] = useState("Whereas the tenant shall bear and pay electricity charges to the concerned authority regularly, without keeping any arrears every month.");
  const [startDate, setStartDate] = useState(today);
  const [durationMonths, setDurationMonths] = useState<number | "">(11);
  const [renewalIncrease, setRenewalIncrease] = useState<number | "">(5);

  const [natureUse, setNatureUse] = useState("The Schedule Property shall be used by the tenant for Residential Purpose Only.");
  const [maintenance, setMaintenance] = useState("Whereas the tenant shall maintain the premises in a neat and tenantable condition and hand over the same, in the same good condition as it was let-out to him.");
  const [scheduleAddress, setScheduleAddress] = useState("");
  const [facilities, setFacilities] = useState("water and an electrical facility");

  const buildPayload = () => ({
    place, agreementDate, premisesType, businessName,
    ownerName, ownerFather, ownerAadhaar, ownerAddress,
    tenantName, tenantFather, tenantAadhaar, tenantAddress,
    securityDeposit: Number(securityDeposit) || 0,
    rent: Number(rent) || 0,
    paymentMethod, otherChargesTitle, otherCharges,
    startDate,
    durationMonths: Number(durationMonths) || 0,
    renewalIncrease: Number(renewalIncrease) || 0,
    natureUse, maintenance, scheduleAddress, facilities,
  });

  const full = "sm:col-span-2";

  return (
    <ToolShell tool="rental" title="Rental Agreement" subtitle="Generate a formatted rental / lease agreement (.docx) with e-stamp space at the top." buildPayload={buildPayload}>
      <Section title="Basic info">
        <Field label="Place of execution" required><Text value={place} onChange={setPlace} /></Field>
        <Field label="Agreement date" required><DateInput value={agreementDate} onChange={setAgreementDate} /></Field>
        <Field label="Premises type" required><Select value={premisesType} onChange={setPremisesType} options={["Residential", "Commercial"]} /></Field>
        {premisesType === "Commercial" && <Field label="Business name"><Text value={businessName} onChange={setBusinessName} placeholder="e.g. GLAMOR ENTERPRISE" /></Field>}
      </Section>

      <Section title="Owner (First Party)">
        <Field label="Owner full name" required><Text value={ownerName} onChange={setOwnerName} /></Field>
        <Field label="Father's name" required><Text value={ownerFather} onChange={setOwnerFather} /></Field>
        <Field label="Aadhaar no." required hint="e.g. 1234 5678 9012"><Text value={ownerAadhaar} onChange={setOwnerAadhaar} /></Field>
        <div className={full}><Field label="Address" required><Area value={ownerAddress} onChange={setOwnerAddress} rows={2} /></Field></div>
      </Section>

      <Section title="Tenant (Second Party)">
        <Field label="Tenant full name" required><Text value={tenantName} onChange={setTenantName} /></Field>
        <Field label="Father's name" required><Text value={tenantFather} onChange={setTenantFather} /></Field>
        <Field label="Aadhaar no." required hint="e.g. 1234 5678 9012"><Text value={tenantAadhaar} onChange={setTenantAadhaar} /></Field>
        <div className={full}><Field label="Address" required><Area value={tenantAddress} onChange={setTenantAddress} rows={2} /></Field></div>
      </Section>

      <Section title="Financials">
        <Field label="Security deposit (₹)" required><Num value={securityDeposit} onChange={setSecurityDeposit} min={0} step={1000} /></Field>
        <Field label="Monthly rent (₹)" required><Num value={rent} onChange={setRent} min={0} step={1000} /></Field>
        <Field label="Payment method" required><Text value={paymentMethod} onChange={setPaymentMethod} /></Field>
        <Field label="Start date" required><DateInput value={startDate} onChange={setStartDate} /></Field>
        <Field label="Duration (months)" required><Num value={durationMonths} onChange={setDurationMonths} min={1} /></Field>
        <Field label="Renewal rent increase (%)" required><Num value={renewalIncrease} onChange={setRenewalIncrease} min={0} /></Field>
        <Field label="Other charges title" required hint="uppercased in the deed"><Text value={otherChargesTitle} onChange={setOtherChargesTitle} /></Field>
        <div className={full}><Field label="Other charges clause" required><Area value={otherCharges} onChange={setOtherCharges} rows={2} /></Field></div>
      </Section>

      <Section title="Clauses & schedule">
        <div className={full}><Field label="Nature of use clause" required><Area value={natureUse} onChange={setNatureUse} rows={2} /></Field></div>
        <div className={full}><Field label="Maintenance clause" required><Area value={maintenance} onChange={setMaintenance} rows={2} /></Field></div>
        <div className={full}><Field label="Schedule property address" required><Area value={scheduleAddress} onChange={setScheduleAddress} rows={2} /></Field></div>
        <Field label="Facilities" required><Text value={facilities} onChange={setFacilities} /></Field>
      </Section>
    </ToolShell>
  );
}

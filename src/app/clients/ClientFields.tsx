"use client";

import { ENTITY_TYPES, GROWTH_GOALS, keysOf } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";
import { istDate } from "@/lib/ist";

export type ClientFormValue = {
  name: string; entityType: string; pan: string; gstin: string; cin: string; industry: string; city: string;
  contactName: string; contactPhone: string; contactEmail: string; referralSource: string; turnover: string;
  growthGoal: string; growthNote: string; onboardedOn: string; primaryHandlerId: string;
};

export function emptyClient(d: Partial<ClientFormValue> = {}): ClientFormValue {
  return {
    name: "", entityType: "PVT_LTD", pan: "", gstin: "", cin: "", industry: "", city: "", contactName: "", contactPhone: "",
    contactEmail: "", referralSource: "", turnover: "", growthGoal: "MAINTAIN", growthNote: "",
    onboardedOn: istDate(new Date()), primaryHandlerId: "", ...d,
  };
}

export const field = "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px]";
export const label = "text-[11px] font-bold text-ink-mute";

export function ClientFields({ value, onChange, handlers }: { value: ClientFormValue; onChange: (v: ClientFormValue) => void; handlers: Handler[] }) {
  const set = (k: keyof ClientFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Client name *</span><input required value={value.name} onChange={set("name")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Entity type *</span>
        <select value={value.entityType} onChange={set("entityType")} className={field}>{keysOf(ENTITY_TYPES).map((k) => <option key={k} value={k}>{ENTITY_TYPES[k]}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1"><span className={label}>Primary handler *</span>
        <select required value={value.primaryHandlerId} onChange={set("primaryHandlerId")} className={field}><option value="">Select…</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1"><span className={label}>PAN</span><input value={value.pan} onChange={set("pan")} placeholder="AAAAA9999A" className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>GSTIN</span><input value={value.gstin} onChange={set("gstin")} className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>CIN / LLPIN</span><input value={value.cin} onChange={set("cin")} className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Industry</span><input value={value.industry} onChange={set("industry")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>City</span><input value={value.city} onChange={set("city")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Referral source</span><input value={value.referralSource} onChange={set("referralSource")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact person</span><input value={value.contactName} onChange={set("contactName")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact phone</span><input value={value.contactPhone} onChange={set("contactPhone")} inputMode="numeric" placeholder="10 digits" className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact email</span><input type="email" value={value.contactEmail} onChange={set("contactEmail")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Annual turnover (₹) *</span><input required type="number" min={0} step={1} value={value.turnover} onChange={set("turnover")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Onboarded on *</span><input required type="date" value={value.onboardedOn} onChange={set("onboardedOn")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Growth goal *</span>
        <select value={value.growthGoal} onChange={set("growthGoal")} className={field}>{keysOf(GROWTH_GOALS).map((k) => <option key={k} value={k}>{GROWTH_GOALS[k]}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Growth note</span><textarea rows={2} value={value.growthNote} onChange={set("growthNote")} className={field} /></label>
    </div>
  );
}

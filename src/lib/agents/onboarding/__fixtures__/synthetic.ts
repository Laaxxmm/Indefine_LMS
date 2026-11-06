// Synthetic identifiers and people for onboarding tests. No real client data.
import { gstinCheckChar } from "@/lib/ai/anonymizer";
import type { Person } from "../people";
import type { OnboardingSpec } from "../spec";

/** A checksum-valid GSTIN for a PAN: state code + PAN + entity number + Z + check character. */
export function gstinFor(state: string, pan: string, entity = "1"): string {
  const first14 = `${state}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}

/** Same GSTIN with a wrong check character. */
export function badChecksum(gstin: string): string {
  const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const c = gstin[14];
  return gstin.slice(0, 14) + B36[(B36.indexOf(c) + 1) % 36];
}

export const PAN = {
  company: "AAACA1234F",
  company2: "AAACB5678K",
  individual: "ABCPK1234M",
  huf: "AAAHR1234K",
  firm: "AAAFS1234Q",
  llp: "AAFFL1234C",
  trust: "AAATT1234B",
};

export const PEOPLE: Person[] = [
  { id: "u-anita", name: "Anita Desai" },
  { id: "u-karthik", name: "Karthik Iyer" },
  { id: "u-meena", name: "Meena Pillai" },
  { id: "u-priya", name: "Priya Sharma" },
  { id: "u-priyan", name: "Priya Nair" },
  { id: "u-ravi", name: "Ravi Kumar" },
];

/** A complete, valid spec (private limited, GST monthly + ROC + Books monthly). */
export function completeSpec(over: Partial<OnboardingSpec> = {}): OnboardingSpec {
  return {
    legalName: "Acme Widgets Private Limited",
    entityType: "PVT_LTD",
    services: [
      { service: "GST", frequency: "MONTHLY" },
      { service: "ROC", frequency: "ANNUAL" },
      { service: "Books", frequency: "MONTHLY" },
    ],
    clientCode: "ACME01",
    fy: "2026-27",
    assigneeId: "u-priya",
    assigneeName: "Priya Sharma",
    reviewerId: "u-ravi",
    reviewerName: "Ravi Kumar",
    pan: PAN.company,
    gstins: [gstinFor("29", PAN.company)],
    cin: "U12345KA2020PTC123456",
    firstPeriod: "2026-11",
    contactName: "Meera Rao",
    contactEmail: "meera@acme.test",
    contactPhone: "9876543210",
    turnoverInr: 25_000_000,
    billing: "Retainer ₹15,000 per month",
    dscHolder: "Director (Meera Rao)",
    booksSoftware: "Tally",
    ...over,
  };
}

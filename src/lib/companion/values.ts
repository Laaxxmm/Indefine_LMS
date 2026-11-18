// Values the side panel offers to copy, so staff paste them on a portal themselves instead of
// retyping. Pure. Which identifiers go out in full is data (FULL_IDENTIFIERS): only where the
// firm's SOP has staff paste them. PAN is never sent in full — last 4 only, not copyable.
// Amounts come only from an APPROVED agent run of the job (the approved pack).
import type { FirmService } from "@prisma/client";
import { figureView } from "@/lib/agents/views";
import { COMPANION_FIGURES_MAX } from "./config";
import { maskLast4 } from "./mask";
import type { CompanionValue } from "./types";

/** Identifiers sent in full, per service, because the SOP has them pasted on that service's portal. */
export const FULL_IDENTIFIERS: Readonly<Record<FirmService, ReadonlyArray<"gstin" | "cin">>> = {
  GST: ["gstin"],
  ROC: ["cin"],
  IncomeTax: [],
  TDS: [],
  Books: [],
  Audit: [],
  Engagement: [],
};

/** Services where the masked PAN is shown as a check that the right client is open. */
export const MASKED_PAN_SERVICES: ReadonlySet<FirmService> = new Set<FirmService>(["IncomeTax", "TDS"]);

export type ValueSource = {
  service: FirmService;
  clientName: string;
  clientCode: string;
  period: string;
  fy: string;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  /** AgentRun.figures of the job's latest APPROVED run, or null when no pack is approved yet. */
  approvedFigures: unknown;
};

/** Paise → "123456.00" / "-1234.50": what a portal field accepts (no ₹, no grouping). */
export function plainRupees(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const sign = paise < 0 && abs > 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const clean = (v: string | null) => (v ?? "").replace(/\s+/g, "").toUpperCase() || null;

export function valuesFor(src: ValueSource): CompanionValue[] {
  const out: CompanionValue[] = [
    { key: "clientName", label: "Client legal name", copy: src.clientName, display: src.clientName },
    { key: "clientCode", label: "Client code", copy: src.clientCode, display: src.clientCode },
  ];
  const full = FULL_IDENTIFIERS[src.service];
  const gstin = clean(src.gstin);
  if (gstin && full.includes("gstin")) out.push({ key: "gstin", label: "GSTIN", copy: gstin, display: gstin });
  const cin = clean(src.cin);
  if (cin && full.includes("cin")) out.push({ key: "cin", label: "CIN", copy: cin, display: cin });
  const pan = maskLast4(src.pan);
  if (pan && MASKED_PAN_SERVICES.has(src.service)) {
    out.push({ key: "pan", label: "PAN", copy: null, display: pan, note: "Last 4 only, for checking that the right client is open." });
  }
  out.push({ key: "period", label: "Period", copy: src.period, display: src.period });
  out.push({ key: "fy", label: "Financial year", copy: src.fy, display: `FY ${src.fy}` });

  const figures = src.approvedFigures && typeof src.approvedFigures === "object" ? (src.approvedFigures as Record<string, unknown>) : {};
  const amounts = Object.entries(figures).filter((e): e is [string, number] => /paise$/i.test(e[0]) && typeof e[1] === "number" && Number.isSafeInteger(e[1]));
  for (const [key, paise] of amounts.slice(0, COMPANION_FIGURES_MAX)) {
    const view = figureView(key, paise);
    out.push({ key: `figure:${key}`, label: view.label, copy: plainRupees(paise), display: view.value, note: "From the approved pack." });
  }
  return out;
}

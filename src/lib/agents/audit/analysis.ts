// Deterministic audit analysis over the parsed inputs: TB totals, lead schedules and their tie,
// materiality, material variances and explanations, CARO determination and clause checklist,
// sampling selections and population ties. Pure: the same extract always gives the same result.
import { nameKey } from "@/lib/agents/books/table";
import { netByLedger, tbTotals, type TbTotals } from "@/lib/agents/books/tb";
import { caroChecklist, caroPendingVerification, determineCaro, fyEndOf, type CaroClause, type CaroDetermination, type CaroFacts, type CaroPendingVerification } from "./caro";
import { MATERIALITY, SAMPLING, VARIANCE } from "./config";
import type { AuditExtract, Population } from "./inputs";
import { buildLeads, isMaterialVariance, type LeadResult, type LeadSchedule } from "./leads";
import { opinionHits } from "./opinion";
import { musSample, musSampleSize, randomSample, type SampleResult } from "./sampling";

export function normalizeAuditExtract(e: Partial<AuditExtract> | null | undefined): AuditExtract {
  return {
    fy: e?.fy ?? null,
    files: e?.files ?? [],
    tb: e?.tb ?? null,
    priorTb: e?.priorTb ?? null,
    profile: e?.profile ?? null,
    populations: e?.populations ?? [],
    explanations: e?.explanations ?? [],
    notes: e?.notes ?? null,
    issues: e?.issues ?? [],
  };
}

export type Variance = { schedule: LeadSchedule; explanation: { row: number; text: string } | null };
export type PopulationTie = { population: string; populationPaise: number; tbPaise: number; ledgers: string[]; differencePaise: number };
export type OpinionInputHit = { file: string; row: number; text: string; phrase: string };

export type AuditAnalysis = {
  tb: TbTotals | null;
  priorTb: TbTotals | null;
  leads: LeadResult | null;
  revenuePaise: number | null;
  priorRevenuePaise: number | null;
  materialityPaise: number;
  performancePaise: number;
  materialityBasis: string;
  variances: Variance[];
  caro: CaroDetermination;
  /** CARO outcomes under small-company limits awaiting partner verification that differ from `caro` (never applied). */
  caroPending: CaroPendingVerification[];
  clauses: CaroClause[];
  samples: { population: Population; result: SampleResult }[];
  ties: PopulationTie[];
  opinionInInputs: OpinionInputHit[];
  missingInputs: string[];
};

const floorRupee = (paise: number) => Math.floor(paise / 100) * 100;
const areaNet = (leads: LeadResult | null, wp: string, year: "cy" | "py") => leads?.schedules.find((s) => s.wp === wp)?.[year === "cy" ? "cyPaise" : "pyPaise"] ?? 0;

/** Planned sample size: the plan's size, else MUS formula (≥ SOP minimum) or the SOP minimum; never above the item count. */
export function plannedSize(p: Population, performancePaise: number): number {
  const count = p.items.length;
  if (p.config.sampleSize !== null) return Math.min(p.config.sampleSize, count);
  const bv = p.items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
  const base = p.config.method === "mus" ? Math.max(musSampleSize(bv, performancePaise, SAMPLING.confidenceFactorTenths), SAMPLING.minSampleSize) : SAMPLING.minSampleSize;
  return Math.min(base, count);
}

const cache = new WeakMap<object, AuditAnalysis>();

export function analyzeAudit(e: AuditExtract): AuditAnalysis {
  const hit = cache.get(e);
  if (hit) return hit;
  const leads = e.tb ? buildLeads(e.tb, e.priorTb) : null;
  const tb = e.tb ? tbTotals(e.tb) : null;
  // Credit balances are negative; `0 - x` (not `-x`) so a nil area is +0, never −0.
  const revenuePaise = leads ? 0 - areaNet(leads, "L-K", "cy") : null;
  const priorRevenuePaise = leads && e.priorTb ? 0 - areaNet(leads, "L-K", "py") : null;
  const otherIncomePaise = leads ? 0 - areaNet(leads, "L-L", "cy") : 0;

  let materialityPaise: number;
  let materialityBasis: string;
  if (e.profile?.materialityPaise) {
    materialityPaise = e.profile.materialityPaise;
    materialityBasis = "Set by the engagement partner (entity profile)";
  } else if (revenuePaise && revenuePaise > 0) {
    materialityPaise = floorRupee(Math.floor((revenuePaise * MATERIALITY.revenueBps) / 10000));
    materialityBasis = `${MATERIALITY.revenueBps / 100}% of revenue from operations`;
  } else {
    materialityPaise = floorRupee(Math.floor(((tb?.debitPaise ?? 0) * MATERIALITY.fallbackTotalDebitsBps) / 10000));
    materialityBasis = `${MATERIALITY.fallbackTotalDebitsBps / 100}% of trial balance total debits (no revenue in the TB)`;
  }
  const performancePaise = floorRupee(Math.floor((materialityPaise * MATERIALITY.performancePercent) / 100));

  const explanationFor = (s: LeadSchedule) => {
    const keys = new Set([s.wp.toLowerCase(), nameKey(s.name)]);
    const x = e.explanations.find((x) => keys.has(x.key.toLowerCase()) || keys.has(nameKey(x.key)));
    return x ? { row: x.row, text: x.text } : null;
  };
  const variances: Variance[] =
    leads && e.priorTb ? leads.schedules.filter((s) => isMaterialVariance(s, performancePaise, VARIANCE.minPercent)).map((schedule) => ({ schedule, explanation: explanationFor(schedule) })) : [];

  const caroTb = { revenuePaise: revenuePaise === null ? null : revenuePaise + otherIncomePaise, priorRevenuePaise };
  const fyEnd = fyEndOf(e.fy);
  const caro = determineCaro(e.profile, caroTb, fyEnd);
  const caroPending = caroPendingVerification(e.profile, caroTb, fyEnd);
  const abs = (wp: string) => Math.abs(areaNet(leads, wp, "cy"));
  const facts: CaroFacts = { ppePaise: abs("L-E"), inventoryPaise: abs("L-G"), investmentsPaise: abs("L-F"), loansAdvancesPaise: abs("L-J"), borrowingsPaise: abs("L-B") };
  const clauses = caroChecklist(caro, e.profile, facts);

  const samples = e.populations.map((population) => {
    const items = population.items.map((i, idx) => ({ index: idx, amountPaise: i.amountPaise }));
    const n = plannedSize(population, performancePaise);
    return { population, result: population.config.method === "mus" ? musSample(items, n, population.config.seed) : randomSample(items, n, population.config.seed) };
  });

  const byLedger = e.tb ? netByLedger(e.tb) : new Map();
  const ties: PopulationTie[] = e.populations
    .filter((p) => p.config.tbLedgers.length)
    .map((p) => {
      const populationPaise = Math.abs(p.items.reduce((s, i) => s + i.amountPaise, 0));
      const tbPaise = Math.abs(p.config.tbLedgers.reduce((s, l) => s + (byLedger.get(nameKey(l))?.netPaise ?? 0), 0));
      return { population: p.name, populationPaise, tbPaise, ledgers: p.config.tbLedgers, differencePaise: populationPaise - tbPaise };
    });

  const opinionInInputs: OpinionInputHit[] = [];
  const scan = (file: string, row: number, text: string) => {
    for (const phrase of opinionHits(text)) opinionInInputs.push({ file, row, text, phrase });
  };
  const explFile = e.files.find((f) => f.kind === "explanations")?.name ?? "explanations";
  for (const x of e.explanations) scan(explFile, x.row, x.text);
  for (const t of [e.tb, e.priorTb]) for (const r of t?.rows ?? []) scan(t!.file, r.row, `${r.ledger} ${r.group}`);
  for (const p of e.populations) for (const i of p.items) scan(p.file, i.row, `${i.ref} ${i.party}`);

  const missingInputs: string[] = [];
  if (!e.priorTb) missingInputs.push("Prior-year trial balance (comparatives and variance analysis)");
  if (!e.profile) missingInputs.push("Entity profile (entity.json) for CARO applicability");
  if (!e.populations.length) missingInputs.push("Ledger detail for sampling (population-*.csv)");
  if (!e.notes) missingInputs.push("Disclosure notes (related parties)");

  const a: AuditAnalysis = { tb, priorTb: e.priorTb ? tbTotals(e.priorTb) : null, leads, revenuePaise, priorRevenuePaise, materialityPaise, performancePaise, materialityBasis, variances, caro, caroPending, clauses, samples, ties, opinionInInputs, missingInputs };
  cache.set(e, a);
  return a;
}

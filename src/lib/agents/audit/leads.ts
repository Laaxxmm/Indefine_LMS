// Lead schedules from the year-end and prior-year trial balances, through the grouping map
// (config.ts LEAD_AREAS, data). Balances are signed: debit positive, credit negative.
import { nameKey } from "@/lib/agents/books/table";
import { netPaise, tbTotals, type TbData, type TbRow } from "@/lib/agents/books/tb";
import { LEAD_AREAS, type LeadArea } from "./config";

export type LeadLine = { ledger: string; group: string; row: number | null; cyPaise: number; pyPaise: number };
export type LeadSchedule = { wp: string; name: string; side: "dr" | "cr"; cyPaise: number; pyPaise: number; variancePaise: number; lines: LeadLine[] };
export type Unmapped = { ledger: string; group: string; row: number; year: "CY" | "PY"; netPaise: number };

export type LeadResult = {
  schedules: LeadSchedule[];
  unmapped: Unmapped[];
  /** Σ of mapped lead balances vs the TB, per year: both must be equal for the leads to tie. */
  tie: { cyLeadsPaise: number; cyTbNetPaise: number; pyLeadsPaise: number | null; pyTbNetPaise: number | null; cyLeadsDebitPaise: number; cyTbDebitPaise: number };
};

export function areaOf(row: Pick<TbRow, "group" | "ledger">, areas: LeadArea[] = LEAD_AREAS): LeadArea | null {
  const g = row.group.toLowerCase();
  for (const a of areas) {
    if (g && a.groups.some((p) => new RegExp(p, "i").test(g))) return a;
    if (a.ledgers?.some((p) => new RegExp(p, "i").test(row.ledger))) return a;
  }
  return null;
}

export function buildLeads(cy: TbData, py: TbData | null, areas: LeadArea[] = LEAD_AREAS): LeadResult {
  const byArea = new Map<string, LeadSchedule>(areas.map((a) => [a.wp, { wp: a.wp, name: a.name, side: a.side, cyPaise: 0, pyPaise: 0, variancePaise: 0, lines: [] }]));
  const unmapped: Unmapped[] = [];
  const lineKey = new Map<string, LeadLine>();
  const add = (r: TbRow, year: "CY" | "PY") => {
    const area = areaOf(r, areas);
    if (!area) {
      unmapped.push({ ledger: r.ledger, group: r.group, row: r.row, year, netPaise: netPaise(r) });
      return;
    }
    const s = byArea.get(area.wp)!;
    const k = `${area.wp}\u0000${nameKey(r.ledger)}`;
    let line = lineKey.get(k);
    if (!line) {
      line = { ledger: r.ledger, group: r.group, row: year === "CY" ? r.row : null, cyPaise: 0, pyPaise: 0 };
      lineKey.set(k, line);
      s.lines.push(line);
    }
    if (year === "CY") {
      line.cyPaise += netPaise(r);
      s.cyPaise += netPaise(r);
      line.row ??= r.row;
    } else {
      line.pyPaise += netPaise(r);
      s.pyPaise += netPaise(r);
    }
  };
  for (const r of cy.rows) add(r, "CY");
  for (const r of py?.rows ?? []) add(r, "PY");
  const schedules = [...byArea.values()].filter((s) => s.lines.length);
  for (const s of schedules) s.variancePaise = s.cyPaise - s.pyPaise;

  const cyTotals = tbTotals(cy);
  const cyLeadsDebitPaise = cy.rows.filter((r) => areaOf(r, areas)).reduce((a, r) => a + r.debitPaise, 0);
  const pyTotals = py ? tbTotals(py) : null;
  return {
    schedules,
    unmapped,
    tie: {
      cyLeadsPaise: schedules.reduce((a, s) => a + s.cyPaise, 0),
      cyTbNetPaise: cyTotals.differencePaise,
      pyLeadsPaise: py ? schedules.reduce((a, s) => a + s.pyPaise, 0) : null,
      pyTbNetPaise: pyTotals ? pyTotals.differencePaise : null,
      cyLeadsDebitPaise,
      cyTbDebitPaise: cyTotals.debitPaise,
    },
  };
}

/** Variance in basis points of |PY| (truncated), or null when PY is nil. */
export const varianceBps = (s: Pick<LeadSchedule, "cyPaise" | "pyPaise">) => (s.pyPaise === 0 ? null : Math.trunc(((s.cyPaise - s.pyPaise) * 10000) / Math.abs(s.pyPaise)));

/** Material variance: |Δ| ≥ PM and (PY nil or |Δ| × 100 ≥ minPercent × |PY|). */
export function isMaterialVariance(s: Pick<LeadSchedule, "cyPaise" | "pyPaise">, performancePaise: number, minPercent: number): boolean {
  const d = Math.abs(s.cyPaise - s.pyPaise);
  if (d === 0 || d < performancePaise) return false;
  return s.pyPaise === 0 || d * 100 >= minPercent * Math.abs(s.pyPaise);
}

// Lead schedules from the year-end and prior-year trial balances, through the grouping map
// (config.ts LEAD_AREAS, data). Balances are signed: debit positive, credit negative.
import { nameKey } from "@/lib/agents/books/table";
import { netPaise, tbTotals, type TbData, type TbRow } from "@/lib/agents/books/tb";
import { LEAD_AREAS, type GroupRule, type LeadArea } from "./config";

export type LeadLine = { ledger: string; group: string; row: number | null; cyPaise: number; pyPaise: number };
export type LeadSchedule = { wp: string; name: string; side: "dr" | "cr"; cyPaise: number; pyPaise: number; variancePaise: number; lines: LeadLine[] };
export type Unmapped = { ledger: string; group: string; row: number; year: "CY" | "PY"; netPaise: number };
/** A group mapped through a pattern that carries a partner note (config.ts GroupRule.verify). */
export type GroupingNote = { group: string; wp: string; verify: string };

export type LeadResult = {
  schedules: LeadSchedule[];
  unmapped: Unmapped[];
  /** Σ of mapped lead balances vs the TB, per year: both must be equal for the leads to tie. */
  tie: { cyLeadsPaise: number; cyTbNetPaise: number; pyLeadsPaise: number | null; pyTbNetPaise: number | null; cyLeadsDebitPaise: number; cyTbDebitPaise: number };
  /** One per (group, lead) mapped by a noted pattern, in first-seen order. */
  groupingNotes: GroupingNote[];
};

type RowLike = Pick<TbRow, "group" | "ledger"> & Partial<Pick<TbRow, "debitPaise" | "creditPaise">>;

/** The area a TB row maps to, and the partner note of the pattern that mapped it (if any). */
export function matchArea(row: RowLike, areas: LeadArea[] = LEAD_AREAS): { area: LeadArea; rule: GroupRule | null } | null {
  const g = row.group.toLowerCase();
  // A conditional pattern's sign: debit for a net debit or nil balance, credit for a net credit.
  const sign = (row.debitPaise ?? 0) - (row.creditPaise ?? 0) < 0 ? "cr" : "dr";
  for (const a of areas) {
    if (g) {
      for (const p of a.groups) {
        if (typeof p === "string") {
          if (new RegExp(p, "i").test(g)) return { area: a, rule: null };
        } else if (new RegExp(p.pattern, "i").test(g) && (!p.sign || p.sign === sign)) return { area: a, rule: p };
      }
    }
    if (a.ledgers?.some((p) => new RegExp(p, "i").test(row.ledger))) return { area: a, rule: null };
  }
  return null;
}

export function areaOf(row: RowLike, areas: LeadArea[] = LEAD_AREAS): LeadArea | null {
  return matchArea(row, areas)?.area ?? null;
}

export function buildLeads(cy: TbData, py: TbData | null, areas: LeadArea[] = LEAD_AREAS): LeadResult {
  const byArea = new Map<string, LeadSchedule>(areas.map((a) => [a.wp, { wp: a.wp, name: a.name, side: a.side, cyPaise: 0, pyPaise: 0, variancePaise: 0, lines: [] }]));
  const unmapped: Unmapped[] = [];
  const groupingNotes: GroupingNote[] = [];
  const lineKey = new Map<string, LeadLine>();
  const add = (r: TbRow, year: "CY" | "PY") => {
    const hit = matchArea(r, areas);
    if (!hit) {
      unmapped.push({ ledger: r.ledger, group: r.group, row: r.row, year, netPaise: netPaise(r) });
      return;
    }
    const area = hit.area;
    if (hit.rule && !groupingNotes.some((n) => n.wp === area.wp && n.group === r.group)) groupingNotes.push({ group: r.group, wp: area.wp, verify: hit.rule.verify });
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
    groupingNotes,
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

// ITC utilisation (set-off) for GSTR-3B Table 6.1 — current order under s.49(5), s.49A and
// rule 88A (Circular 98/17/2019-GST):
//
//   1. IGST credit is used first, and must be used in full before any CGST/SGST credit:
//        a. against IGST liability;
//        b. the remainder against CGST and SGST liability "in any order and in any proportion"
//           (rule 88A). This module first covers the part of each liability that the head's own
//           credit cannot cover (CGST deficit, then SGST deficit) — which minimises cash — then
//           any remaining CGST, then SGST liability. Leftover IGST credit carries forward.
//   2. CGST credit: against CGST liability, then against IGST liability. Never against SGST.
//   3. SGST/UTGST credit: against SGST liability, then against IGST liability — the latter only
//      once CGST credit is exhausted (proviso to s.49(5)(d)); step 2 runs first, so any IGST
//      liability still open at step 3 means CGST credit is nil. Never against CGST.
//   4. Cess credit only against cess liability (s.11 Compensation Cess Act); no cross-utilisation.
//   5. Reverse-charge liability is never set off: it is paid in cash (s.49(4) read with the
//      definition of output tax) and is added to cash after set-off.
//
// Pure integer-paise arithmetic; no amount is ever negative here (callers clamp first).
import { HEADS, zeroTax, type Head, type TaxSplit } from "./money";

export type Utilisation = Record<Head, TaxSplit>; // credit head → liability head → amount
export type SetoffResult = {
  liability: TaxSplit;
  credit: TaxSplit;
  rcm: TaxSplit;
  used: Utilisation;
  /** Liability (forward charge) left after credit, per head. */
  unpaid: TaxSplit;
  /** unpaid + rcm: what goes to the cash ledger. */
  cash: TaxSplit;
  /** Credit left to carry forward. */
  closingCredit: TaxSplit;
  creditUtilised: number;
};

const assertNonNegative = (t: TaxSplit, what: string) => {
  for (const h of HEADS) if (!Number.isSafeInteger(t[h]) || t[h] < 0) throw new RangeError(`set-off: ${what}.${h} must be a non-negative integer, got ${t[h]}`);
};

export function setOff(liability: TaxSplit, credit: TaxSplit, rcm: TaxSplit = zeroTax()): SetoffResult {
  assertNonNegative(liability, "liability");
  assertNonNegative(credit, "credit");
  assertNonNegative(rcm, "rcm");
  const L = { ...liability };
  const C = { ...credit };
  const used: Utilisation = { igst: zeroTax(), cgst: zeroTax(), sgst: zeroTax(), cess: zeroTax() };
  const apply = (from: Head, to: Head, cap = Infinity) => {
    const u = Math.min(C[from], L[to], cap);
    if (u <= 0) return;
    C[from] -= u;
    L[to] -= u;
    used[from][to] += u;
  };

  // 1. IGST credit.
  apply("igst", "igst");
  apply("igst", "cgst", Math.max(0, L.cgst - C.cgst));
  apply("igst", "sgst", Math.max(0, L.sgst - C.sgst));
  apply("igst", "cgst");
  apply("igst", "sgst");
  // 2. CGST credit.
  apply("cgst", "cgst");
  apply("cgst", "igst");
  // 3. SGST credit (IGST only after CGST credit is exhausted — guaranteed by step 2).
  apply("sgst", "sgst");
  if (C.cgst === 0) apply("sgst", "igst");
  // 4. Cess.
  apply("cess", "cess");

  const cash = { igst: L.igst + rcm.igst, cgst: L.cgst + rcm.cgst, sgst: L.sgst + rcm.sgst, cess: L.cess + rcm.cess };
  const creditUtilised = HEADS.reduce((n, f) => n + HEADS.reduce((m, t) => m + used[f][t], 0), 0);
  return { liability: { ...liability }, credit: { ...credit }, rcm: { ...rcm }, used, unpaid: { ...L }, cash, closingCredit: { ...C }, creditUtilised };
}

// Date helpers shared by the legal-document generators (ported from the source suite).

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd"
export function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// "2026-07-16" -> "16th day of July, 2026" (the source's `effective_date` phrasing).
export function longEffectiveDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${ordinal(d)} day of ${MONTHS[(m || 1) - 1]}, ${y}`;
}

// "2026-07-16" -> "16/07/2026"
export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// "2026-07-16" -> "16th July 2026"
export function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${ordinal(d)} ${MONTHS[(m || 1) - 1]} ${y}`;
}

// Add whole days to an ISO date (UTC math to avoid tz drift). Returns ISO yyyy-mm-dd.
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

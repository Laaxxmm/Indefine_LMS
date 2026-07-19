// Indian-English number → words (Lakh/Crore system). Ported from the source suite.
export function numToWords(num: number): string {
  const n = Math.floor(Math.abs(num));
  if (n === 0) return "Zero";

  const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const above100: Record<number, string> = { 100: "Hundred", 1000: "Thousand", 100000: "Lakh", 10000000: "Crore" };
  const pivots = Object.keys(above100).map(Number).sort((a, b) => b - a);

  if (n < 20) return units[n];
  if (n < 100) return (tens[Math.floor(n / 10)] + (n % 10 === 0 ? "" : " " + units[n % 10])).trim();

  const pivot = pivots.find((p) => p <= n) || 100;
  const quot = Math.floor(n / pivot);
  const rem = n % pivot;
  const p3 = rem !== 0 ? numToWords(rem) : "";
  return `${numToWords(quot)} ${above100[pivot]}${p3 ? " " + p3 : ""}`;
}

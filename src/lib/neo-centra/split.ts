// Bucket 3 profit-split resolution — pure, so it's unit-checkable without Turia/DB.
// A saved manual split (e.g. {a:40, b:60}) wins only when it covers *every* currently
// assigned partner; if a partner was added/removed since it was saved, the split is
// stale and profit divides equally instead. No assigned partners → no shares.
export function profitPercents(assignedIds: string[], saved: Record<string, number> | null): Record<string, number> {
  const n = assignedIds.length;
  if (n === 0) return {};
  const useSaved = !!saved && assignedIds.every((id) => typeof saved[id] === "number");
  return Object.fromEntries(assignedIds.map((id) => [id, useSaved ? saved![id] : 100 / n]));
}

// Resolve "assign Priya, reviewer Ravi" to LMS users. Pure: the caller passes the active people
// (src/lib/clients/services.ts listHandlers). A name resolves only when exactly one person
// matches; otherwise the clarifier asks, offering the candidates.
import type { PartialSpec } from "./spec";

export interface Person {
  id: string;
  name: string;
}

export interface Resolution {
  id: string | null;
  candidates: Person[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function resolvePerson(name: string | null | undefined, people: Person[]): Resolution {
  const q = norm(name ?? "");
  if (!q) return { id: null, candidates: [] };
  const tiers: Array<(p: string) => boolean> = [
    (p) => p === q, // full name
    (p) => p.split(" ")[0] === q, // first name
    (p) => p.split(" ").includes(q), // any name part
    (p) => p.startsWith(q) || p.split(" ").some((part) => part.startsWith(q)), // prefix ("Pri")
  ];
  for (const match of tiers) {
    const hits = people.filter((p) => match(norm(p.name)));
    if (hits.length === 1) return { id: hits[0].id, candidates: hits };
    if (hits.length > 1) return { id: null, candidates: hits };
  }
  return { id: null, candidates: [] };
}

/** Fill assigneeId / reviewerId from their names when the match is unique. Ids already set are kept. */
export function resolvePeople(spec: PartialSpec, people: Person[]): { spec: PartialSpec; candidates: { assigneeId: Person[]; reviewerId: Person[] } } {
  const out: PartialSpec = { ...spec };
  const candidates = { assigneeId: [] as Person[], reviewerId: [] as Person[] };
  for (const [idField, nameField] of [["assigneeId", "assigneeName"], ["reviewerId", "reviewerName"]] as const) {
    const id = out[idField];
    const known = id ? people.find((p) => p.id === id) : undefined;
    if (known) {
      out[nameField] = known.name;
      continue;
    }
    if (id) out[idField] = undefined; // not an active person any more
    const r = resolvePerson(out[nameField], people);
    candidates[idField] = r.candidates;
    if (r.id) {
      out[idField] = r.id;
      out[nameField] = r.candidates[0].name;
    }
  }
  return { spec: out, candidates };
}

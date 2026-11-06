// People and client matching for the Turia pull. Pure: the sync loads the rows, these decide.
//
//   people   Turia user -> active LMS User: same email (case-insensitive) first, then the exact
//            normalised name when exactly one active user has it. Otherwise unmatched, for an
//            admin to pick on /admin/firm-os/turia-sync (the pick is kept).
//   clients  Turia client -> LMS Client: the Turia client code equal to a FirmClient code first,
//            then the exact normalised name when exactly one client has it. Otherwise unmatched,
//            for an admin to pick or ignore.
//   codes    A new FirmClient takes Turia's client code when it is a valid, free folder-contract
//            code (A-Z 0-9, 3-10 characters, not a Windows reserved name); otherwise one is made
//            from the name and numbered until it is free.
import { isValidClientCode } from "@/lib/integrations/sharepoint/paths";
import { normName } from "./normalise";

export type LmsUserRow = { id: string; name: string | null; email: string };
export type PersonMatch = { userId: string; matchedBy: "email" | "name" };

const personName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function matchPerson(t: { name: string; email: string | null }, activeUsers: readonly LmsUserRow[]): PersonMatch | null {
  const email = t.email?.trim().toLowerCase();
  if (email) {
    const byEmail = activeUsers.find((u) => u.email.trim().toLowerCase() === email);
    if (byEmail) return { userId: byEmail.id, matchedBy: "email" };
  }
  const name = personName(t.name);
  if (!name) return null;
  const byName = activeUsers.filter((u) => personName(u.name) === name);
  return byName.length === 1 ? { userId: byName[0].id, matchedBy: "name" } : null;
}

export type LmsClientRow = { id: string; name: string; firmClient: { id: string; clientCode: string } | null };

export function matchClient(t: { name: string; code: string | null }, clients: readonly LmsClientRow[]): LmsClientRow | null {
  const code = t.code?.trim().toUpperCase();
  if (code) {
    const byCode = clients.find((c) => c.firmClient?.clientCode === code);
    if (byCode) return byCode;
  }
  const key = normName(t.name);
  if (!key) return null;
  const byName = clients.filter((c) => normName(c.name) === key);
  return byName.length === 1 ? byName[0] : null;
}

const SUFFIX_WORDS = new Set(["the", "and", "of", "private", "limited", "llp", "company", "pvt", "ltd", "india", "m", "s"]);

/** A free, valid client code for a new FirmClient (see the header). */
export function clientCodeFor(name: string, turiaCode: string | null, taken: ReadonlySet<string>): string {
  const fromTuria = turiaCode?.trim().toUpperCase() ?? "";
  if (isValidClientCode(fromTuria) && !taken.has(fromTuria)) return fromTuria;
  const parts = normName(name).split(" ").filter((w) => w && !SUFFIX_WORDS.has(w)).map((w) => w.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  let base = parts.length ? parts[0].slice(0, 6) + parts.slice(1).map((w) => w[0]).join("") : "";
  base = base.slice(0, 8);
  if (base.length < 3) base = (base + "CLT").slice(0, 3);
  if (isValidClientCode(base) && !taken.has(base)) return base;
  for (let n = 1; n < 1000; n++) {
    const suffix = String(n).padStart(2, "0");
    const code = base.slice(0, 10 - suffix.length) + suffix;
    if (isValidClientCode(code) && !taken.has(code)) return code;
  }
  throw new Error("No free client code could be made from this name");
}

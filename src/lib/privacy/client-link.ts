// Re-audit NEW-8: a certificate or engagement letter issued from a client record is linked to it by
// id (CertificateIssue.clientId / EngagementLetter.clientId), so the privacy register finds it by
// the record, never by a typed name another person or business can share. The link is kept only
// while the typed name is still the record's own name: an edited name is treated as another entity
// (no link; the register then lists it as a name-only manual check if the names match).
/** The one read this needs (PrismaClient satisfies it). */
export type ClientLinkDb = { client: { findUnique(args: { where: { id: string }; select: { id: true; name: true } }): Promise<{ id: string; name: string } | null> } };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export type ClientLink = { ok: true; clientId: string | null } | { ok: false; status: 400; error: string };

/** The client record id to store with a certificate / letter, or null (no link asked for, or the name was changed). */
export async function clientLinkFor(db: ClientLinkDb, clientId: unknown, typedName: string): Promise<ClientLink> {
  if (clientId === undefined || clientId === null || clientId === "") return { ok: true, clientId: null };
  if (typeof clientId !== "string" || !ID.test(clientId)) return { ok: false, status: 400, error: "The client record link is not valid. Open the client again and start from there." };
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) return { ok: false, status: 400, error: "That client record could not be found. Open the client again and start from there." };
  return { ok: true, clientId: same(client.name, typedName) ? client.id : null };
}

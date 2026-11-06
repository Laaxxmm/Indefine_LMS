// Clients: the LMS Client master and its Firm OS client code (FirmClient). Visible to everyone who
// may open /clients/[id] (canViewClients). Text search covers the name, the folder name and the
// client code — never PAN, GSTIN, phone or email, which only the exact identifier lookup reads
// (src/lib/search/identifiers.ts).
import type { Prisma } from "@prisma/client";
import { ENTITY_TYPES } from "@/lib/clients/core";
import { canFindClients } from "../access";
import { line } from "../format";
import { clientLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";
import type { SearchHit } from "../types";

export const clientSelect = {
  id: true,
  name: true,
  folderName: true,
  entityType: true,
  city: true,
  active: true,
  updatedAt: true,
  firmClient: { select: { id: true, clientCode: true } },
} satisfies Prisma.ClientSelect;
export type ClientRow = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

/** One client result. `matched` (masked) is set by the identifier lookup. */
export function clientHit(r: ClientRow, rank: SearchHit["rank"], matched?: string): SearchHit {
  const code = r.firmClient?.clientCode ?? null;
  return {
    type: "client",
    id: r.id,
    label: maskText(r.name),
    context: line(matched && `Matched ${matched}`, code ? `Client code ${code}` : "No client code yet", ENTITY_TYPES[r.entityType], maskText(r.city), !r.active && "Inactive"),
    ...clientLink(r.id),
    rank,
    at: r.updatedAt.toISOString(),
    ...(matched ? { matched, refs: { clientId: r.id, firmClientId: r.firmClient?.id ?? null } } : {}),
  };
}

const termWhere = (t: string): Prisma.ClientWhereInput => ({
  OR: [{ name: { contains: t, mode: "insensitive" } }, { folderName: { contains: t, mode: "insensitive" } }, { firmClient: { clientCode: { contains: t.toUpperCase() } } }],
});

export const clientsProvider: SearchProvider = defineProvider({
  type: "client",
  canUse: canFindClients,

  async search({ db, q, terms, limit, exactOnly }) {
    const exactWhere: Prisma.ClientWhereInput = { OR: [{ id: q }, { firmClient: { clientCode: q.toUpperCase() } }, { name: { equals: q, mode: "insensitive" } }] };
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.client.findMany({ where: exactWhere, select: clientSelect, take: 5 }) : Promise.resolve([] as ClientRow[]),
      exactOnly ? Promise.resolve([] as ClientRow[]) : db.client.findMany({ where: { AND: terms.map(termWhere) }, select: clientSelect, orderBy: { updatedAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((r) => {
      const rank = rankMatch(q, { ids: [r.id], codes: [r.firmClient?.clientCode], text: [r.name, r.folderName] });
      return rank === null ? null : clientHit(r, rank);
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});

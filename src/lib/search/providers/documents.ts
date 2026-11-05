// Client documents (KYC and job files filed to SharePoint). Metadata only: the file name, its type
// and the client; the file link (webUrl) is not returned — the client's page lists and opens it.
// Visible to everyone who may open /clients/[id] (canViewClients).
import type { ClientDocType, Prisma } from "@prisma/client";
import { DOC_TYPES } from "@/lib/clients/core";
import { canFindClients } from "../access";
import { day, line } from "../format";
import { clientLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";

const select = {
  id: true,
  name: true,
  docType: true,
  createdAt: true,
  clientId: true,
  client: { select: { name: true } },
  job: { select: { fy: true, serviceType: { select: { name: true } } } },
} satisfies Prisma.ClientDocumentSelect;
type Row = Prisma.ClientDocumentGetPayload<{ select: typeof select }>;

const docTypesMatching = (t: string) => (Object.keys(DOC_TYPES) as ClientDocType[]).filter((k) => DOC_TYPES[k].toLowerCase().includes(t));

function termWhere(t: string): Prisma.ClientDocumentWhereInput {
  const types = docTypesMatching(t);
  return { OR: [{ name: { contains: t, mode: "insensitive" } }, ...(types.length ? [{ docType: { in: types } }] : [])] };
}

export const documentsProvider: SearchProvider = defineProvider({
  type: "document",
  canUse: canFindClients,

  async search({ db, q, terms, limit, exactOnly }) {
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.clientDocument.findMany({ where: { id: q }, select, take: 1 }) : Promise.resolve([] as Row[]),
      exactOnly ? Promise.resolve([] as Row[]) : db.clientDocument.findMany({ where: { AND: terms.map(termWhere) }, select, orderBy: { createdAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((d) => {
      const rank = rankMatch(q, { ids: [d.id], text: [d.name, DOC_TYPES[d.docType]] });
      if (rank === null) return null;
      return {
        type: "document" as const,
        id: d.id,
        label: maskText(d.name),
        context: line(DOC_TYPES[d.docType], maskText(d.client.name), d.job ? `${d.job.serviceType.name} FY ${d.job.fy}` : "Client KYC", `uploaded ${day(d.createdAt)}`),
        ...clientLink(d.clientId),
        rank,
        at: d.createdAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});

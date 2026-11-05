// Client comms drafts. Visible to the draft's creator, the assignee of its job, and managers,
// partners and admins (access.ts draftScopeWhere). Matches the subject, the client code and name,
// and the kind of message. The body is never read: it is not selected, searched or shown.
import type { Prisma } from "@prisma/client";
import { canFindDrafts, draftScopeWhere } from "../access";
import type { SearchDb } from "../db";
import { DRAFT_KIND_LABELS, LANGUAGE_LABELS, day, line } from "../format";
import { draftLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";
import type { SearchHit } from "../types";

/** No `body` here, on purpose (DPDP: drafts carry client personal data). */
const select = {
  id: true,
  subject: true,
  kind: true,
  language: true,
  createdAt: true,
  firmClientId: true,
  jobTaskId: true,
  outlookDraftId: true,
} satisfies Prisma.CommsDraftSelect;
type Row = Prisma.CommsDraftGetPayload<{ select: typeof select }>;

const kindsMatching = (t: string) => Object.entries(DRAFT_KIND_LABELS).filter(([k, label]) => k.includes(t) || label.toLowerCase().includes(t)).map(([k]) => k);

/** FirmClient ids whose code or client name contains the word (drafts have no relation to filter through). */
async function clientIdsMatching(db: SearchDb, t: string): Promise<string[]> {
  const rows = await db.firmClient.findMany({
    where: { OR: [{ clientCode: { contains: t.toUpperCase() } }, { client: { name: { contains: t, mode: "insensitive" } } }] },
    select: { id: true },
    take: 50,
  });
  return rows.map((r) => r.id);
}

export const draftsProvider: SearchProvider = defineProvider({
  type: "draft",
  canUse: canFindDrafts,

  async search({ db, user, q, terms, limit, exactOnly }) {
    const scope = await draftScopeWhere(db, user);
    let some: Row[] = [];
    if (!exactOnly) {
      const perTerm = await Promise.all(terms.map((t) => clientIdsMatching(db, t)));
      const termWhere = (t: string, i: number): Prisma.CommsDraftWhereInput => {
        const kinds = kindsMatching(t);
        return {
          OR: [
            { subject: { contains: t, mode: "insensitive" } },
            ...(perTerm[i].length ? [{ firmClientId: { in: perTerm[i] } }] : []),
            ...(kinds.length ? [{ kind: { in: kinds } }] : []),
          ],
        };
      };
      some = await db.commsDraft.findMany({ where: { AND: [scope, ...terms.map(termWhere)] }, select, orderBy: { createdAt: "desc" }, take: fetchCap(limit) });
    }
    const exact = isSingleToken(q) || exactOnly ? await db.commsDraft.findMany({ where: { AND: [scope, { id: q }] }, select, take: 1 }) : [];
    const rows = [...exact, ...some];
    const clientIds = [...new Set(rows.map((r) => r.firmClientId))];
    const clients = clientIds.length
      ? await db.firmClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, clientCode: true, lmsClientId: true, client: { select: { name: true } } } })
      : [];
    const byId = new Map(clients.map((c) => [c.id, c]));
    const hits = rows.map((d): SearchHit | null => {
      const fc = byId.get(d.firmClientId);
      if (!fc) return null; // no client to open it from
      const kind = DRAFT_KIND_LABELS[d.kind] ?? "Message";
      const rank = rankMatch(q, { ids: [d.id], codes: [fc.clientCode], text: [d.subject, fc.client?.name, kind] });
      if (rank === null) return null;
      return {
        type: "draft",
        id: d.id,
        label: maskText(d.subject),
        context: line(kind, LANGUAGE_LABELS[d.language] ?? "Other language", fc.clientCode, `drafted ${day(d.createdAt)}`, d.outlookDraftId && "Saved to Outlook drafts"),
        ...draftLink(fc.lmsClientId),
        rank,
        at: d.createdAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});

// Firm OS onboarding runs, for the people who may open /onboard (canOnboard: partners, managers,
// admins — the page opens any run for them). Matches the legal name and client code in the run's
// spec and the run id. The prompt (free text, may hold personal data) is never searched or shown.
import type { Prisma } from "@prisma/client";
import { canFindOnboarding } from "../access";
import { ONBOARDING_STATUS_LABELS, day, line } from "../format";
import { onboardingLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";
import type { SearchHit } from "../types";

export const onboardingSelect = { id: true, status: true, spec: true, firmClientId: true, createdAt: true, updatedAt: true } satisfies Prisma.OnboardingRunSelect;
export type OnboardingRow = Prisma.OnboardingRunGetPayload<{ select: typeof onboardingSelect }>;

/** The few spec fields search reads (OnboardingRun.spec is a PartialSpec, src/lib/agents/onboarding/spec.ts). */
export type SpecView = { legalName?: unknown; clientCode?: unknown; pan?: unknown; gstins?: unknown; contactPhone?: unknown; contactEmail?: unknown };
export const specOf = (r: OnboardingRow): SpecView => (r.spec && typeof r.spec === "object" && !Array.isArray(r.spec) ? (r.spec as SpecView) : {});
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One onboarding result. `matched` (masked) is set by the identifier lookup. */
export function onboardingHit(r: OnboardingRow, rank: SearchHit["rank"], matched?: string): SearchHit {
  const s = specOf(r);
  const name = str(s.legalName);
  const code = str(s.clientCode);
  return {
    type: "onboarding",
    id: r.id,
    label: name ? maskText(name) : "Onboarding with no client name yet",
    context: line(matched && `Matched ${matched}`, ONBOARDING_STATUS_LABELS[r.status] ?? "In progress", code && `client code ${code}`, `started ${day(r.createdAt)}`),
    ...onboardingLink(r.id),
    rank,
    at: r.updatedAt.toISOString(),
    ...(matched ? { matched, refs: { firmClientId: r.firmClientId } } : {}),
  };
}

const termWhere = (t: string): Prisma.OnboardingRunWhereInput => ({
  OR: [{ spec: { path: ["legalName"], string_contains: t, mode: "insensitive" } }, { spec: { path: ["clientCode"], string_contains: t.toUpperCase() } }],
});

export const onboardingProvider: SearchProvider = defineProvider({
  type: "onboarding",
  canUse: canFindOnboarding,

  async search({ db, q, terms, limit, exactOnly }) {
    const exactWhere: Prisma.OnboardingRunWhereInput = { OR: [{ id: q }, { spec: { path: ["clientCode"], equals: q.toUpperCase() } }] };
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.onboardingRun.findMany({ where: exactWhere, select: onboardingSelect, take: 5 }) : Promise.resolve([] as OnboardingRow[]),
      exactOnly
        ? Promise.resolve([] as OnboardingRow[])
        : db.onboardingRun.findMany({ where: { AND: terms.map(termWhere) }, select: onboardingSelect, orderBy: { updatedAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((r) => {
      const s = specOf(r);
      const rank = rankMatch(q, { ids: [r.id], codes: [str(s.clientCode)], text: [str(s.legalName)] });
      return rank === null ? null : onboardingHit(r, rank);
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canSearch } from "@/lib/search/access";
import { defaultSearchDeps } from "@/lib/search/defaults";
import { isSensitiveQuery } from "@/lib/search/query";
import { SEARCH_MESSAGES } from "@/lib/search/schema";
import { search, searchableTypes } from "@/lib/search/service";
import { isSearchType, type SearchResponse } from "@/lib/search/types";
import { eyebrow, pageTitle } from "@/app/agents/parts";
import { SearchPanel } from "./SearchPanel";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string | string[]; type?: string | string[] }> };

// Search across what the person may open. A text query in the address (?q=) is run here so the
// page can be bookmarked and shared; identifiers never are (they stay out of URLs).
export default async function SearchPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canSearch(session.user)) redirect("/dashboard");
  const sp = await searchParams;
  const types = searchableTypes(session.user);
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const type = isSearchType(sp.type) && types.includes(sp.type) ? sp.type : null;

  let initial: SearchResponse | null = null;
  let notice: string | null = null;
  let query = rawQ;
  if (rawQ.trim()) {
    if (isSensitiveQuery(rawQ)) {
      notice = SEARCH_MESSAGES.identifierInPageAddress;
      query = "";
    } else {
      const r = await search(session.user, { q: rawQ, type }, defaultSearchDeps());
      if (r.ok) initial = r.data;
      else notice = r.error;
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS</p>
        <h1 className={pageTitle}>Search</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Find clients, jobs, agent runs, deliverables, comms drafts and onboarding records. You see only what you are allowed to open.
        </p>
      </div>
      <SearchPanel types={types} initialQuery={query} initialType={type} initial={initial} initialNotice={notice} />
    </div>
  );
}

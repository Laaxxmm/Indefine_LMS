import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canDecideMistakes, canSeeAllRuns } from "@/lib/agents/access";
import { loadMistakesPage } from "./load";
import { MistakesView } from "./MistakesView";

export const dynamic = "force-dynamic";

// Mistake log for partners and managers (who decide) and admins (who may look). The admin
// area's /admin/firm-os/mistakes renders the same view; partners need not be LMS admins.
export default async function AgentMistakesPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canDecideMistakes(session.user) && !canSeeAllRuns(session.user)) redirect("/agents");
  const { data, names } = await loadMistakesPage(session.user);
  return <MistakesView data={data} names={names} backHref={{ href: "/agents", label: "Runs" }} />;
}

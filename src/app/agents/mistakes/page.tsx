import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canSeeAllRuns, canSeeMistakeLog } from "@/lib/agents/access";
import { runsListLabel } from "../parts";
import { loadMistakesPage } from "./load";
import { MistakesView } from "./MistakesView";

export const dynamic = "force-dynamic";

// Mistake log for partners and managers (who decide) and admins (who may look). The admin
// area's /admin/firm-os/mistakes renders the same view; partners need not be LMS admins.
export default async function AgentMistakesPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canSeeMistakeLog(session.user)) redirect("/agents");
  const { data, names } = await loadMistakesPage(session.user);
  return <MistakesView data={data} names={names} back={{ href: "/agents", label: runsListLabel(canSeeAllRuns(session.user)) }} />;
}

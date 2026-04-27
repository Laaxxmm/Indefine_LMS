import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loadRecap } from "@/lib/recap";
import RecapStory from "./RecapStory";

export const dynamic = "force-dynamic";

export default async function RecapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const sp = await searchParams;
  const q = sp.q ? Number(sp.q) : undefined;
  const validQ = q && q >= 1 && q <= 4 ? q : undefined;

  const recap = await loadRecap(session.user.id, validQ);
  if (!recap) redirect("/dashboard");

  return <RecapStory recap={recap} />;
}

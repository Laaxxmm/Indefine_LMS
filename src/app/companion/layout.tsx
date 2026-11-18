import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { pageMain } from "@/components/ui";
import { requireCompanion } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Firm OS Companion pairing, only for people who may pair (the companion's rule with the person's
// switch from the workspace settings); others go to the dashboard, which says why. The page keeps
// its own check (src/lib/companion/access.ts) and says so plainly too.
export default async function CompanionLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  await requireCompanion(session.user);

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/companion" />
      <main className={pageMain}>{children}</main>
    </div>
  );
}

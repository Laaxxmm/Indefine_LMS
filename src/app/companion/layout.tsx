import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
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
      <FirmOsHeader user={session.user} home="/companion" width="max-w-[1180px]" />
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

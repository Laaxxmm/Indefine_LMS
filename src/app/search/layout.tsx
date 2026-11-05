import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { canSearch } from "@/lib/search/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Firm OS search. Every active person (while the Search module is on for them); each result type
// follows its own page's rule (src/lib/search/access.ts).
export default async function SearchLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canSearch(session.user)) redirect("/dashboard");
  await requireModule(session.user, "search");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/search" width="max-w-[1180px]" />
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

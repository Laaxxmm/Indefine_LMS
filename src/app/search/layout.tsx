import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { pageMain } from "@/components/ui";
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
      <FirmOsHeader user={session.user} home="/search" />
      <main className={pageMain}>{children}</main>
    </div>
  );
}

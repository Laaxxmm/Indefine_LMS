import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { loadMistakesPage } from "@/app/agents/mistakes/load";
import { MistakesView } from "@/app/agents/mistakes/MistakesView";

export const dynamic = "force-dynamic";

// Firm OS · mistake log in the admin area (the admin layout already limits it to admins).
// Approve / reject appear only for an admin who is also a partner or manager; partners who are
// not LMS admins use /agents/mistakes.
export default async function AdminMistakesPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
  const { data, names } = await loadMistakesPage(session.user);
  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <MistakesView data={data} names={names} backHref={{ href: "/admin", label: "Admin" }} />
    </main>
  );
}

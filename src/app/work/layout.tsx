import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AreaHeader } from "@/components/AreaHeader";
import { pageGutter } from "@/components/ui";
import { actorFrom } from "@/lib/work/actor";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Signed-out users go to sign-in. Signed-in users who are not on WORK_TRACKER_EMAILS get a
// 404 so the module stays invisible to the rest of the firm.
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!actorFrom(session)) notFound();
  await requireModule(session.user, "work");

  return (
    <div className="min-h-screen">
      <AreaHeader
        home="/work"
        area="Tech work"
        width="max-w-[1400px]"
        // "Today" is current on /work and a work item's page, not on Board or Week.
        links={[
          { href: "/work", label: "Today", except: ["/work/board", "/work/week"] },
          { href: "/work/board", label: "Board" },
          { href: "/work/week", label: "Week" },
        ]}
      />
      <main className={`max-w-[1400px] mx-auto ${pageGutter} py-8`}>{children}</main>
    </div>
  );
}

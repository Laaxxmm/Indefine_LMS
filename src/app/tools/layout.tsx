import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AreaHeader } from "@/components/AreaHeader";
import { pageGutter } from "@/components/ui";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  // Internal-active users only (§2). No `!!user` fallback.
  if (!canUseCertificateTool(session.user)) redirect("/dashboard");
  await requireModule(session.user, "tools");

  return (
    <div className="min-h-screen">
      {/* "All tools" is the area's page (marked aria-current="page" there, "true" inside a tool). */}
      <AreaHeader home="/tools" area="Tools" links={[{ href: "/tools", label: "All tools" }]} />
      <main className={`max-w-[1180px] mx-auto ${pageGutter} py-8`}>{children}</main>
    </div>
  );
}

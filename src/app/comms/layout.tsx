import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FirmOsHeader } from "@/components/FirmOsHeader";
import { canUseAgents } from "@/lib/agents/access";
import { requireModule } from "@/lib/workspace/guard";

export const dynamic = "force-dynamic";

// Firm OS client message drafts. Drafts only: staff copy a draft or open it as an Outlook draft in
// their own mailbox and send it themselves; nothing on these pages sends anything.
export default async function CommsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseAgents(session.user)) redirect("/dashboard");
  await requireModule(session.user, "comms");

  return (
    <div className="min-h-screen">
      <FirmOsHeader user={session.user} home="/comms" />
      <main className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

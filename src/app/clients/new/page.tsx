import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canViewClients, fyOptions } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { OnboardForm } from "./OnboardForm";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewClients(session.user)) redirect("/dashboard");
  const [services, handlers] = await Promise.all([listServiceTypes(), listHandlers()]);
  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Onboard</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">New client</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">Client details, the first job, and KYC documents. Folders are created on SharePoint automatically.</p>
      </div>
      <OnboardForm services={services} handlers={handlers} fys={fyOptions()} meId={session.user.id} />
    </div>
  );
}

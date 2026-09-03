import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isClientsAdmin } from "@/lib/clients/core";
import { listServiceTypes } from "@/lib/clients/services";
import { ServicesManager } from "./ServicesManager";

export const dynamic = "force-dynamic";

export default async function ServicesAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isClientsAdmin(session.user)) redirect("/clients");
  const services = await listServiceTypes(true);
  return (
    <div>
      <div className="mb-5">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Admin</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">Services</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">Services offered under each department. Deactivated services stay on existing jobs but disappear from the pickers.</p>
      </div>
      <ServicesManager services={services} />
    </div>
  );
}

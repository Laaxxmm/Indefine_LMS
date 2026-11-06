import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AreaHeader, type AreaNavItem } from "@/components/AreaHeader";
import { pageGutter } from "@/components/ui";
import { canViewClients, isClientsAdmin } from "@/lib/clients/core";
import { requireModule } from "@/lib/workspace/guard";
import { isModuleEnabled } from "@/lib/workspace/settings";

export const dynamic = "force-dynamic";

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewClients(session.user)) redirect("/dashboard");
  await requireModule(session.user, "clients");
  const onboard = await isModuleEnabled(session.user, "onboard"); // Firm OS onboarding: role, master switch, settings

  // "All clients" is current on the list and on a client's own page, not on the area's other pages.
  const links: AreaNavItem[] = [
    { href: "/clients", label: "All clients", except: ["/clients/new", "/clients/reports", "/clients/admin"] },
    { href: "/clients/new", label: "Onboard" },
    ...(onboard ? [{ href: "/onboard", label: "Firm OS onboarding" }] : []),
    { href: "/clients/reports", label: "Reports" },
    ...(isClientsAdmin(session.user) ? [{ href: "/clients/admin/services", label: "Services" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <AreaHeader home="/clients" area="Clients" links={links} />
      <main className={`max-w-[1180px] mx-auto ${pageGutter} py-8`}>{children}</main>
    </div>
  );
}

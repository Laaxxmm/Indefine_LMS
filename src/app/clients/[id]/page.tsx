import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ENTITY_TYPES, GROWTH_GOALS, TURNOVER_BANDS, canManageClients, canViewClients, fyOptions } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { ClientPanels } from "./ClientPanels";
import { EditClient } from "./EditClient";
import { istDate } from "@/lib/ist";
import { isClPathsEnabled } from "@/lib/integrations/sharepoint/flags";
import { clientSiteLink, jobFolderLink } from "@/lib/integrations/sharepoint/client-links";
import { canSeeAllRuns } from "@/lib/agents/access";
import { listClientJobs, type ClientJobsDb } from "@/lib/agents/client-jobs";
import { FirmOsJobs } from "./FirmOsJobs";
import { RevealPii } from "./RevealPii";
import { canRevealClientPii } from "@/lib/rbac/policy";
import { maskClientPii, type PiiField } from "@/lib/clients/pii";

export const dynamic = "force-dynamic";

const ist = (d: Date | null) => (d ? istDate(d) : "");
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewClients(session.user)) redirect("/dashboard");
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      primaryHandler: { select: { name: true, email: true } },
      jobs: { orderBy: [{ fy: "desc" }, { createdAt: "desc" }], include: { serviceType: true, _count: { select: { documents: true } } } },
      documents: { orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true, email: true } } } },
    },
  });
  if (!client) notFound();
  const [services, handlers] = await Promise.all([listServiceTypes(), listHandlers()]);
  const canManage = canManageClients(session.user);
  // FIRM_OS_CL_PATHS (default off): folder links resolve to the CL-{Code} site, and the client's Firm OS
  // jobs are listed. Off, or no FirmClient → legacy, unchanged (no FirmClient or JobTask query).
  const clPaths = isClPathsEnabled();
  const firmClient = clPaths ? await prisma.firmClient.findUnique({ where: { lmsClientId: id }, select: { clientCode: true } }) : null;
  const clientCode = firmClient?.clientCode ?? null;
  const siteLink = clientSiteLink({ clPaths, clientCode });
  const firmJobs = firmClient ? await listClientJobs(prisma as unknown as ClientJobsDb, session.user, id) : null;

  // DPDP (ADR-006 class A): PAN, GSTIN, phone and email are shown masked to everyone; management
  // (canRevealClientPii) gets a "Show" per value, and each Show is an AuditEvent.
  const reveal = canRevealClientPii(session.user);
  const pii = (field: PiiField, value: string | null): React.ReactNode => {
    const masked = maskClientPii(field, value);
    if (!masked) return null;
    return reveal ? <RevealPii key={field} clientId={client.id} field={field} masked={masked} /> : masked;
  };
  const contact = [client.contactName, pii("phone", client.contactPhone), pii("email", client.contactEmail)].filter(Boolean);
  const facts: Array<[string, React.ReactNode]> = [
    ["Entity", ENTITY_TYPES[client.entityType]], ["PAN", pii("pan", client.pan) ?? "—"], ["GSTIN", pii("gstin", client.gstin) ?? "—"], ["CIN", client.cin ?? "—"],
    ["Industry", client.industry ?? "—"], ["City", client.city ?? "—"],
    ["Contact", contact.length ? contact.map((c, i) => <span key={i}>{i > 0 && " · "}{c}</span>) : "—"],
    ["Referral", client.referralSource ?? "—"], ["Turnover", `${inr(client.turnover)} (${TURNOVER_BANDS[client.turnoverBand]})`],
    ["Growth goal", `${GROWTH_GOALS[client.growthGoal]}${client.growthNote ? ` — ${client.growthNote}` : ""}`],
    ["Onboarded", ist(client.onboardedOn)], ["Primary handler", client.primaryHandler.name ?? client.primaryHandler.email],
  ];

  return (
    <div>
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4"><ArrowLeft className="w-4 h-4" /> All clients</Link>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Client{!client.active && " · inactive"}</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">{client.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {siteLink ? (
            <a href={siteLink.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] text-brand-600 font-semibold"><FolderOpen className="w-4 h-4" /> SharePoint: {siteLink.label}</a>
          ) : client.graphFolderId && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-mute"><FolderOpen className="w-4 h-4" /> SharePoint: Clients / {client.folderName}</span>
          )}
          {canManage && (
            <EditClient
              handlers={handlers}
              client={{
                id: client.id, active: client.active, name: client.name, entityType: client.entityType, pan: client.pan ?? "", gstin: client.gstin ?? "",
                cin: client.cin ?? "", industry: client.industry ?? "", city: client.city ?? "", contactName: client.contactName ?? "",
                contactPhone: client.contactPhone ?? "", contactEmail: client.contactEmail ?? "", referralSource: client.referralSource ?? "",
                turnover: String(client.turnover), growthGoal: client.growthGoal, growthNote: client.growthNote ?? "",
                onboardedOn: ist(client.onboardedOn), primaryHandlerId: client.primaryHandlerId,
              }}
            />
          )}
        </div>
      </div>

      <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 rounded-2xl bg-card border border-border shadow-lift p-5 mb-6 text-[13.5px]">
        {facts.map(([k, v]) => <div key={k}><dt className="text-[11px] font-bold text-ink-faint uppercase tracking-wide">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
      </dl>

      {firmJobs && <FirmOsJobs jobs={firmJobs} seesAll={canSeeAllRuns(session.user)} commsHref={clientCode ? `/comms/new?client=${clientCode}` : undefined} />}

      <ClientPanels
        clientId={client.id}
        folderStatus={client.folderStatus}
        jobs={client.jobs.map((j) => ({ id: j.id, fy: j.fy, department: j.serviceType.department, service: j.serviceType.name, handlerId: j.handlerId, status: j.status, dueOn: ist(j.dueOn), fees: j.fees?.toString() ?? "", notes: j.notes ?? "", folderStatus: j.folderStatus, docCount: j._count.documents, folderHref: jobFolderLink({ clPaths, clientCode, fy: j.fy, department: j.serviceType.department, serviceName: j.serviceType.name })?.href }))}
        documents={client.documents.map((d) => ({ id: d.id, jobId: d.jobId, docType: d.docType, name: d.name, webUrl: d.webUrl, uploadedBy: d.uploadedBy.name ?? d.uploadedBy.email, createdAt: ist(d.createdAt) }))}
        services={services}
        handlers={handlers}
        fys={fyOptions()}
        canManage={canManage}
        meId={session.user.id}
      />
    </div>
  );
}

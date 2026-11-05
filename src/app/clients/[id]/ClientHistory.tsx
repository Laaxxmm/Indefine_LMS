// The correction history links for a client page: the LMS client record and, when it is linked
// (FIRM_OS_CL_PATHS on and a FirmClient exists), its Firm OS record. The corrections service is
// part of Firm OS, so nothing shows — and nothing is read — while FIRM_OS_ENABLED is off.
// Kept in its own file so the client page needs one line for it.
import { prisma } from "@/lib/prisma";
import { HistoryLink } from "@/components/CorrectionHistory";
import { isClPathsEnabled } from "@/lib/integrations/sharepoint/flags";
import { firmOsEnabled } from "@/lib/workspace/flag";

export async function ClientHistory({ clientId }: { clientId: string }) {
  if (!firmOsEnabled()) return null;
  const firm = isClPathsEnabled() ? await prisma.firmClient.findUnique({ where: { lmsClientId: clientId }, select: { id: true } }) : null;
  return (
    <div className="flex flex-col gap-2 mb-5">
      <HistoryLink entity="Client" id={clientId} />
      {firm && <HistoryLink entity="FirmClient" id={firm.id} label="Firm OS record history" />}
    </div>
  );
}

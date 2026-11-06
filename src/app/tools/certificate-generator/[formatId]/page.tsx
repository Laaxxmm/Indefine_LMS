import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canViewClients } from "@/lib/clients/core";
import { byId, isEnabled } from "@/lib/certificates/registry";
import { prisma } from "@/lib/prisma";
import { CertificateForm } from "./CertificateForm";

export const dynamic = "force-dynamic";

export default async function FormatPage({ params, searchParams }: { params: Promise<{ formatId: string }>; searchParams?: Promise<{ clientId?: string }> }) {
  const { formatId } = await params;
  const template = byId(formatId);
  const isProd = process.env.NODE_ENV === "production";
  // Unknown or (in prod) not-yet-enabled → back to the picker.
  if (!template || (isProd && !isEnabled(template))) redirect("/tools/certificate-generator");

  // Re-audit NEW-8: opened from a client record (?clientId=), the certificate is linked to that
  // record by id, so the privacy register never has to match it by the typed name.
  const clientId = (await searchParams)?.clientId;
  let linkedClient: { id: string; name: string } | null = null;
  if (clientId && /^[A-Za-z0-9_-]{1,64}$/.test(clientId)) {
    const session = await auth();
    if (session?.user && canViewClients(session.user)) linkedClient = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  }

  // The full template (incl. locked text) is passed to the client for the live preview
  // only. The client submits nothing but field values; the server re-loads its own pinned
  // copy from the registry at issue time (§0.3).
  return <CertificateForm template={template} linkedClient={linkedClient} />;
}

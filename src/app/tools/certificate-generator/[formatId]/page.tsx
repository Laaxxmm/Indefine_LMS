import { redirect } from "next/navigation";
import { byId, isEnabled } from "@/lib/certificates/registry";
import { CertificateForm } from "./CertificateForm";

export const dynamic = "force-dynamic";

export default async function FormatPage({ params }: { params: Promise<{ formatId: string }> }) {
  const { formatId } = await params;
  const template = byId(formatId);
  const isProd = process.env.NODE_ENV === "production";
  // Unknown or (in prod) not-yet-enabled → back to the picker.
  if (!template || (isProd && !isEnabled(template))) redirect("/tools/certificate-generator");

  // The full template (incl. locked text) is passed to the client for the live preview
  // only. The client submits nothing but field values; the server re-loads its own pinned
  // copy from the registry at issue time (§0.3).
  return <CertificateForm template={template} />;
}

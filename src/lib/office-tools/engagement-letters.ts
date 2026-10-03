// Engagement letter register: SharePoint layout, file names and the standard email.
// Files: <GRAPH_EL_ROOT>/<client>/EL_<client>_FY26-27.pdf (+ _Draft, _Client-signed). The name is
// fixed per client per FY, so a re-upload replaces the file and SharePoint keeps the
// earlier ones in its version history.
import { ensureFolder, getAppOnlyToken, uploadFileContent } from "@/lib/graph";
import { folderName } from "@/lib/clients/core";

export const MAX_PDF_BYTES = 3 * 1024 * 1024; // sendMail takes the whole message in one 4 MB request

export type FileKind = "draft" | "signed" | "client";

export const elRoot = () => (process.env.GRAPH_EL_ROOT || "Engagement Letters").replace(/^\/+|\/+$/g, "");
const driveId = () => process.env.GRAPH_DRIVE_ID ?? "";

/** "2026-04-01" → "26-27" (Indian FY, April–March). Mirrors fy() in the generator page. */
export function fyOf(start: string): string | null {
  const m = String(start ?? "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const y = Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1;
  return `${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** "26-27" → "2026-27" */
export const fyLabel = (fy: string) => `20${fy}`;

export function fileName(clientName: string, fy: string, kind: FileKind): string {
  const base = `EL_${folderName(clientName).replace(/\s+/g, "_")}_FY${fy}`;
  return `${base}${{ draft: "_Draft", signed: "", client: "_Client-signed" }[kind]}.pdf`;
}

/** Upload (create or replace) a letter PDF into Engagement Letters/<client>/. */
export async function uploadLetterPdf(clientName: string, fy: string, kind: FileKind, bytes: Uint8Array) {
  const d = driveId();
  const t = await getAppOnlyToken();
  if (!d || !t) throw new Error("SharePoint is not configured (GRAPH_DRIVE_ID / app credentials)");
  const client = folderName(clientName);
  await ensureFolder(d, "", elRoot(), t);
  await ensureFolder(d, elRoot(), client, t);
  const item = await uploadFileContent(d, `${elRoot()}/${client}/${fileName(clientName, fy, kind)}`, bytes, "application/pdf", t);
  return { driveId: d, ...item };
}

export type LetterData = Record<string, unknown> & {
  client?: string; salutation?: string; sigTitle?: string; sigName?: string; email?: string; sigEmail?: string;
  extraSigs?: { email?: string }[];
};

export const isEmail = (s: unknown): s is string => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Default recipients: the client's email and every client signatory's email, de-duplicated. */
export function defaultRecipients(data: LetterData): string[] {
  const all = [data.email, data.sigEmail, ...(data.extraSigs ?? []).map((s) => s.email)].filter(isEmail).map((s) => s.trim());
  return all.filter((e, i) => all.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
}

/** The standard covering emails (draft for approval / signed letter), same for every client. Editable before sending. */
export function emailTemplate(data: LetterData, fy: string, senderName: string, kind: "draft" | "signed") {
  // Same default as the letter: "Mr. Ravi Kumar".
  const salute = (data.salutation || [data.sigTitle, (data.sigName ?? "").trim()].filter(Boolean).join(" ") || "Sir/Madam").trim();
  const sign = `Regards,
${senderName}
Streamlining Workflows Consultancy Private Limited
+91 86609 49078 | info@indefine.in`;
  if (kind === "draft") {
    return {
      subject: `Engagement Letter for your approval - ${data.client ?? ""} - FY ${fyLabel(fy)}`,
      text: `Dear ${salute},

Greetings from Indefine.

Please find attached engagement letter for FY ${fyLabel(fy)}, which sets out the scope of services, our professional fees and the general terms of engagement.

We request you to confirm your approval by replying to this email or let us know any changes you would like. Once approved, we will send you the signed engagement letter for your countersignature.

${sign}`,
    };
  }
  return {
    subject: `Engagement Letter - ${data.client ?? ""} - FY ${fyLabel(fy)}`,
    text: `Dear ${salute},

Thank you for approving the draft engagement letter.

Please find attached our signed engagement letter for FY ${fyLabel(fy)}. We request you to countersign it (a signed scan or a DSC-signed PDF) and return it by replying to this email.

We look forward to working with you.

${sign}`,
  };
}

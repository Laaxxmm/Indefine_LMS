// Shared DOCX response helpers for the certificate API routes.
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "certificate";

// `<formatId>_<clientName>_<yyyy-mm-dd>.docx`
export function certificateFilename(formatId: string, clientName: string, isoDate: string): string {
  return `${slug(formatId)}_${slug(clientName)}_${isoDate.slice(0, 10)}.docx`;
}

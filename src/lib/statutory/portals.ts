// Portals covered by the statutory-updates digest, the report tabs they sit in, and
// the standing caveats that hold on every run. Portal names are stored on each post,
// so renaming one here orphans its history — add, don't rename.

export const TABS: { name: string; portals: string[] }[] = [
  { name: "Income Tax", portals: ["Income Tax (CBDT)", "Income Tax e-filing portal"] },
  { name: "GST", portals: ["GST – CBIC", "GST – GSTN", "GST Council", "CBIC (cbic-gst.gov.in)"] },
  { name: "MCA", portals: ["MCA"] },
  { name: "Labour", portals: ["Ministry of Labour & Employment"] },
  { name: "EPFO", portals: ["EPFO"] },
  { name: "ESIC", portals: ["ESIC"] },
  { name: "Professional Tax", portals: ["Professional Tax – Karnataka"] },
  { name: "ICAI", portals: ["ICAI"] },
];

export const ALL_PORTALS = TABS.flatMap((t) => t.portals);

// These refuse non-Indian IPs, so the LMS server (Railway) cannot reach them; the
// statutory-extension collects them from an office PC in India and pushes them in.
export const EXTENSION_PORTALS = ["Income Tax (CBDT)", "GST – CBIC", "GST – GSTN", "MCA", "EPFO", "ESIC"];

// Limits of a portal itself, not of one run. A successful run of these is "partial".
export const STANDING_NOTES: Record<string, { status?: "partial"; note: string }> = {
  "GST – CBIC": { status: "partial", note: "Only the latest-updates feed is read." },
  EPFO: { status: "partial", note: "Site shows no posting dates (file-server dates used); circulars archive stops in 2025." },
  "GST Council": { status: "partial", note: "What's New / Newsletter dates come from the file server." },
  "Professional Tax – Karnataka": { status: "partial", note: "Homepage ticker is undated; the state tax site does not load." },
  MCA: { note: "PDFs cannot be read; summaries are from titles." },
};

export type Tag = "Action" | "Info" | "Internal";
export const TAG_LABEL: Record<Tag, string> = { Action: "Action", Info: "For information", Internal: "Internal / admin" };
export const TAG_RANK: Record<string, number> = { Action: 0, Info: 1, Internal: 2 };

// Collected item, same shape as the skill's adapters produce (server or extension).
export type RawItem = {
  portal: string;
  section: string | null;
  doc_type: string;
  title: string;
  issue_date: string | null;
  upload_date: string | null;
  date_basis: string;
  url: string | null;
  alt_url: string | null;
  text: string | null;
};

export const effDate = (x: { upload_date: string | null; issue_date: string | null }) => x.upload_date || x.issue_date;

/** Today in IST as YYYY-MM-DD, shifted by `days`. */
export function istDay(days = 0, now = Date.now()): string {
  return new Date(now + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
}

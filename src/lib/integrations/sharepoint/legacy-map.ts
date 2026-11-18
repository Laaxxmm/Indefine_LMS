// Legacy /clients layout → Path A mapping (docs/folder-contract.md §4). Pure: the dry-run
// report (scripts/map-legacy-folders.ts) and the FIRM_OS_CL_PATHS links both use it.
// Proposes targets only; nothing here moves, copies or deletes anything.
import type { ClientDocType, Department } from "@prisma/client";
import { departmentLabel } from "@/lib/ca-firm";
import { fyFor, isKycDocType, safeName } from "@/lib/clients/core";
import {
  COMPLIANCE_LIBRARY, clSiteName, deliverablePath, isValidClientCode, normalizeFy, servicePath,
  type DeliverableKind, type ServiceFolder,
} from "./paths";

/** Service folder for a legacy job, or null when Path A has no home for it (Tech/Admin/General). */
export function legacyServiceToCl(department: Department, serviceName: string): ServiceFolder | null {
  const name = serviceName.toLowerCase();
  switch (department) {
    case "TAX":
      if (/\bgst\b/.test(name)) return "GST";
      if (/\btds\b/.test(name)) return "TDS";
      return "IncomeTax";
    case "AUDIT":
      return "Audit";
    case "ACCOUNTS":
      return "Books";
    case "ROC":
      return "ROC";
    default:
      return null;
  }
}

/** Services whose work has one period per FY. */
export function isAnnualService(s: ServiceFolder): boolean {
  return s === "Audit" || s === "ROC" || s === "IncomeTax" || s === "Engagement";
}

/** Which kind folder a legacy document belongs in. */
export function legacyDocKind(t: ClientDocType): DeliverableKind {
  if (isKycDocType(t) || t === "SOURCE_DATA") return "ClientDocs";
  if (t === "FILED_RETURN" || t === "ACKNOWLEDGEMENT" || t === "SIGN_OFF") return "Final";
  return "Working";
}

export interface LegacyJob { jobId: string; fy: string; department: Department; serviceName: string }
export interface LegacyClient {
  clientId: string;
  clientName: string;
  folderName: string;
  clientCode: string | null;
  onboardedOn: Date;
  jobs: LegacyJob[];
  /** From a Graph listing of GRAPH_CLIENTS_ROOT; null when not checked. */
  legacyFolderExists: boolean | null;
}

export type MappingStatus = "MAPPED" | "NO_CODE" | "INVALID_CODE" | "UNMAPPED" | "INVALID_FY";
export interface MappingRow {
  client: string;
  clientCode: string;
  legacyPath: string;
  target: string;
  targetUrl: string;
  status: MappingStatus;
  note: string;
}

/** Legacy job folder exactly as src/lib/clients/storage.ts builds it. */
export function legacyJobPath(root: string, folderName: string, job: Pick<LegacyJob, "fy" | "department" | "serviceName">): string {
  return `${root}/${folderName}/${job.fy}/${safeName(departmentLabel(job.department))}/${safeName(job.serviceName)}`;
}

const display = (code: string, path: string) => `${clSiteName(code)}/${COMPLIANCE_LIBRARY}/${path}`;

export function mapLegacyClient(c: LegacyClient, opts: { legacyRoot: string; host?: string }): MappingRow[] {
  const base = `${opts.legacyRoot}/${c.folderName}`;
  const missingNote = c.legacyFolderExists === false ? "legacy folder not found on SharePoint" : "";
  const row = (r: Omit<MappingRow, "client" | "clientCode">): MappingRow => ({ client: c.clientName, clientCode: c.clientCode ?? "", ...r });
  const join = (...notes: string[]) => notes.filter(Boolean).join("; ");

  if (!c.clientCode) {
    return [row({ legacyPath: base, target: "", targetUrl: "", status: "NO_CODE", note: join("set FirmClient.clientCode to map this client", missingNote) })];
  }
  if (!isValidClientCode(c.clientCode)) {
    return [row({ legacyPath: base, target: "", targetUrl: "", status: "INVALID_CODE", note: join(`"${c.clientCode}" breaks the code rule (A–Z0–9, 3–10)`, missingNote) })];
  }
  const code = c.clientCode;
  const kyc = deliverablePath(code, fyFor(c.onboardedOn), "Engagement", "Annual", "ClientDocs", opts.host);
  const rows: MappingRow[] = [
    row({ legacyPath: `${base}/KYC`, target: display(code, kyc.path), targetUrl: kyc.webUrl, status: "MAPPED", note: join("KYC → onboarding FY Engagement", missingNote) }),
  ];
  for (const j of c.jobs) {
    const legacyPath = legacyJobPath(opts.legacyRoot, c.folderName, j);
    const svc = legacyServiceToCl(j.department, j.serviceName);
    if (!svc) {
      rows.push(row({ legacyPath, target: "", targetUrl: "", status: "UNMAPPED", note: `${departmentLabel(j.department)} work has no Path A service folder; needs a decision` }));
      continue;
    }
    let fy: string;
    try {
      fy = normalizeFy(j.fy);
    } catch {
      rows.push(row({ legacyPath, target: "", targetUrl: "", status: "INVALID_FY", note: `job FY "${j.fy}" is not YYYY-YY` }));
      continue;
    }
    if (isAnnualService(svc)) {
      const p = deliverablePath(code, fy, svc, "Annual", "Working", opts.host);
      const folder = p.segments.slice(0, 3).join("/");
      rows.push(row({ legacyPath, target: display(code, `${folder}/{Working|Final|ClientDocs}`), targetUrl: p.webUrl.replace(/\/Working$/, ""), status: "MAPPED", note: "kind per document type" }));
    } else {
      const p = servicePath(code, fy, svc, opts.host);
      rows.push(row({ legacyPath, target: display(code, `${p.path}/{Period}/{Working|Final|ClientDocs}`), targetUrl: p.webUrl, status: "MAPPED", note: "period folder (YYYY-MM / Qn) per file; kind per document type" }));
    }
  }
  return rows;
}

export function mapLegacyFolders(clients: LegacyClient[], opts: { legacyRoot: string; host?: string }): MappingRow[] {
  return clients.flatMap((c) => mapLegacyClient(c, opts));
}

const COLUMNS: Array<[keyof MappingRow, string]> = [
  ["client", "Client"], ["clientCode", "Code"], ["legacyPath", "Legacy path"], ["target", "Proposed Path A target"], ["status", "Status"], ["note", "Note"],
];

export function mappingToMarkdown(rows: MappingRow[], meta: { generatedAt: string }): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const counts = (["MAPPED", "NO_CODE", "INVALID_CODE", "UNMAPPED", "INVALID_FY"] as MappingStatus[])
    .map((s) => `${s} ${rows.filter((r) => r.status === s).length}`)
    .join(" · ");
  return [
    `## Legacy → Path A mapping (DRY RUN — nothing was moved) — ${meta.generatedAt}`,
    "",
    counts,
    "",
    `| ${COLUMNS.map(([, h]) => h).join(" | ")} |`,
    `|${COLUMNS.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${COLUMNS.map(([k]) => cell(r[k])).join(" | ")} |`),
    "",
  ].join("\n");
}

export function mappingToCsv(rows: MappingRow[]): string {
  const keys: Array<keyof MappingRow> = ["client", "clientCode", "legacyPath", "target", "targetUrl", "status", "note"];
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n") + "\n";
}

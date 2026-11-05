// /clients folder links under FIRM_OS_CL_PATHS (docs/folder-contract.md §5). Pure.
// Flag off, or no valid client code → legacy behaviour (unchanged; no new links).
import type { Department } from "@prisma/client";
import { isValidFy } from "@/lib/clients/core";
import { legacyServiceToCl } from "./legacy-map";
import { clSiteName, clSiteUrl, isValidClientCode, normalizeFy, servicePath } from "./paths";

export interface ClLink { label: string; href: string }

const usable = (clPaths: boolean, code: string | null | undefined): code is string => clPaths && isValidClientCode(code);

/** Link to the client's CL-{Code} site, or null to keep the legacy header. */
export function clientSiteLink(o: { clPaths: boolean; clientCode: string | null | undefined; host?: string }): ClLink | null {
  if (!usable(o.clPaths, o.clientCode)) return null;
  return { label: clSiteName(o.clientCode), href: clSiteUrl(o.clientCode, o.host) };
}

/** Link to a job's Compliance/FY…/{Service} folder, or null (legacy: no job link). */
export function jobFolderLink(o: {
  clPaths: boolean;
  clientCode: string | null | undefined;
  fy: string;
  department: Department;
  serviceName: string;
  host?: string;
}): ClLink | null {
  if (!usable(o.clPaths, o.clientCode) || !isValidFy(o.fy)) return null;
  const svc = legacyServiceToCl(o.department, o.serviceName);
  if (!svc) return null;
  return { label: `${normalizeFy(o.fy)}/${svc}`, href: servicePath(o.clientCode, o.fy, svc, o.host).webUrl };
}

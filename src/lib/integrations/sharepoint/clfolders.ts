// Idempotent provisioning of CL-{Code} sites and their FY trees (docs/folder-contract.md §3).
// Every function checks before it creates, returns what it created, and running it twice
// leaves SharePoint unchanged the second time. Nothing here deletes, moves or renames.
import { readSharePointConfig, requirePnp, SITE_OWNER_BLOCKED_ACTION, type SharePointConfig } from "./config";
import { BlockedError, NotProvisionedError } from "./errors";
import { defaultSharePointClient } from "./factory";
import type { ColumnDefinition, GraphSite, SharePointClient } from "./graph-client";
import {
  CLIENT_LISTS, CLIENT_UPLOAD_GROUP, COMPLIANCE_LIBRARY, KINDS, PathError, SERVICES,
  clSiteName, clSiteUrl, defaultPeriods, normalizeFy, parsePeriod, periodInFy, validateClientCode, validateService,
  type Period, type ServiceFolder,
} from "./paths";

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export interface ClFoldersDeps {
  client: SharePointClient;
  config: SharePointConfig;
  sleep?: (ms: number) => Promise<void>;
  /** Poll interval and attempts while a new site provisions / appears in Graph. */
  pollMs?: number;
  maxPolls?: number;
}

export interface EnsureSiteResult { siteUrl: string; siteId: string; hubSiteId: string; created: string[] }
export interface EnsureTreeResult { siteUrl: string; driveId: string; folders: number; created: string[] }
export interface EnsureResult { siteUrl: string; created: string[] }

export interface FyTreeOptions {
  /** Services to ensure (default: all seven). */
  services?: ServiceFolder[];
  /** Period folders per service (default: defaultPeriods). */
  periods?: Partial<Record<ServiceFolder, Period[]>>;
}

const LIST_COLUMNS: Record<(typeof CLIENT_LISTS)[number], ColumnDefinition[]> = {
  ClientObligations: [
    { name: "Service", choice: { choices: [...SERVICES] } },
    { name: "Period", text: {} },
    { name: "DueDate", dateTime: { format: "dateOnly" } },
    { name: "Status", choice: { choices: ["Open", "In progress", "Filed", "Closed"] } },
    { name: "JobTaskId", text: {} },
  ],
  ClientRequests: [
    { name: "Service", choice: { choices: [...SERVICES] } },
    { name: "Period", text: {} },
    { name: "RequestedOn", dateTime: { format: "dateOnly" } },
    { name: "DueDate", dateTime: { format: "dateOnly" } },
    { name: "Status", choice: { choices: ["Open", "Received", "Closed"] } },
  ],
};

/** The folders ensureFyTree wants, parent path → child names, in creation order. */
export function fyTreePlan(fy: string | Date, opts: FyTreeOptions = {}): Array<[string, string[]]> {
  const fyL = normalizeFy(fy);
  const services = (opts.services ?? [...SERVICES]).map(validateService);
  const plan: Array<[string, string[]]> = [["", [fyL]], [fyL, services]];
  for (const svc of services) {
    const periods = (opts.periods?.[svc] ?? defaultPeriods(svc, fyL)).map(parsePeriod);
    for (const p of periods) if (!periodInFy(p, fyL)) throw new PathError(`Period ${p} is outside ${fyL}`);
    plan.push([`${fyL}/${svc}`, periods]);
    for (const p of periods) plan.push([`${fyL}/${svc}/${p}`, [...KINDS]]);
  }
  return plan;
}

export function createClFolders(deps: ClFoldersDeps) {
  const { client, config } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 5_000;
  const maxPolls = deps.maxPolls ?? 24;
  const host = config.tenantHost;

  async function requireSite(code: string): Promise<{ siteUrl: string; site: GraphSite }> {
    const siteUrl = clSiteUrl(validateClientCode(code), host);
    const site = await client.getSiteByUrl(siteUrl);
    if (!site) throw new NotProvisionedError(`${clSiteName(code)} does not exist yet: run ensureClientSite("${code}") first`);
    return { siteUrl, site };
  }

  async function hubId(): Promise<string> {
    const hub = await client.getSiteInfo(config.hubSiteUrl);
    if (!hub) throw new BlockedError(`Create the hub site ${config.hubSiteUrl} (communication site) in the SharePoint admin center.`);
    if (!hub.IsHubSite) {
      throw new BlockedError(
        `Register ${config.hubSiteUrl} as a hub site: SharePoint admin center → Active sites → select the site → Hub → Register as hub site.`,
      );
    }
    return hub.HubSiteId && hub.HubSiteId !== ZERO_GUID ? hub.HubSiteId : hub.Id;
  }

  async function createSite(code: string, siteUrl: string): Promise<void> {
    if (!config.siteOwner) throw new BlockedError(SITE_OWNER_BLOCKED_ACTION);
    let status = await client.createCommunicationSite(host, {
      Title: clSiteName(code),
      Url: siteUrl,
      Owner: config.siteOwner,
      Description: `Compliance documents for client ${code} (Indefine Firm OS, Path A).`,
    });
    for (let i = 0; status.SiteStatus === 1 && i < maxPolls; i++) {
      await sleep(pollMs);
      status = await client.getSiteCreationStatus(host, siteUrl);
    }
    if (status.SiteStatus !== 2) throw new Error(`Site creation for ${siteUrl} did not finish (SiteStatus ${status.SiteStatus})`);
  }

  async function waitForGraphSite(siteUrl: string): Promise<GraphSite> {
    for (let i = 0; i <= maxPolls; i++) {
      const site = await client.getSiteByUrl(siteUrl);
      if (site) return site;
      if (i < maxPolls) await sleep(pollMs);
    }
    throw new NotProvisionedError(`${siteUrl} was created but is not visible through Graph yet; retry later`);
  }

  return {
    /** Site exists and is associated with the Indefine-Compliance hub. Creates/joins only what is missing. */
    async ensureClientSite(code: string): Promise<EnsureSiteResult> {
      const siteUrl = clSiteUrl(validateClientCode(code), host);
      requirePnp(config); // fail before touching anything when the certificate is missing
      const created: string[] = [];
      let site = await client.getSiteByUrl(siteUrl);
      if (!site) {
        await createSite(code, siteUrl);
        created.push(`site ${clSiteName(code)}`);
        site = await waitForGraphSite(siteUrl);
      }
      const hub = await hubId();
      const info = await client.getSiteInfo(siteUrl);
      if (!info) throw new NotProvisionedError(`${siteUrl} is not reachable through SharePoint REST`);
      if (info.HubSiteId.toLowerCase() !== hub.toLowerCase()) {
        await client.joinHubSite(siteUrl, hub);
        created.push(`hub association ${clSiteName(code)} → ${config.hubSiteUrl}`);
      }
      return { siteUrl, siteId: site.id, hubSiteId: hub, created };
    },

    /** Compliance library + FY/Service/Period/{Working,Final,ClientDocs} folders. */
    async ensureFyTree(code: string, fy: string | Date, opts: FyTreeOptions = {}): Promise<EnsureTreeResult> {
      const plan = fyTreePlan(fy, opts); // validate everything before any call
      const { siteUrl, site } = await requireSite(code);
      const created: string[] = [];
      let drive = await client.getDriveByName(site.id, COMPLIANCE_LIBRARY);
      if (!drive) {
        await client.createList(site.id, { displayName: COMPLIANCE_LIBRARY, template: "documentLibrary" });
        created.push(`library ${COMPLIANCE_LIBRARY}`);
        drive = await client.getDriveByName(site.id, COMPLIANCE_LIBRARY);
        if (!drive) throw new NotProvisionedError(`Library ${COMPLIANCE_LIBRARY} on ${siteUrl} was created but has no drive yet; retry`);
      }
      const fresh = new Set<string>(); // folders created this run: known empty, no need to list them
      let folders = 0;
      for (const [parent, names] of plan) {
        const existing = fresh.has(parent) ? new Set<string>() : new Set((await client.listChildren(drive.id, parent)).map((c) => c.name));
        for (const name of names) {
          folders++;
          const path = parent ? `${parent}/${name}` : name;
          if (existing.has(name)) continue;
          const r = await client.createFolder(drive.id, parent, name);
          if (r.created) {
            fresh.add(path);
            created.push(`folder ${COMPLIANCE_LIBRARY}/${path}`);
          }
        }
      }
      return { siteUrl, driveId: drive.id, folders, created };
    },

    /** ClientObligations + ClientRequests generic lists. */
    async ensureClientLists(code: string): Promise<EnsureResult> {
      const { siteUrl, site } = await requireSite(code);
      const created: string[] = [];
      for (const name of CLIENT_LISTS) {
        if (await client.getList(site.id, name)) continue;
        const r = await client.createList(site.id, { displayName: name, template: "genericList", columns: LIST_COLUMNS[name] });
        if (r.created) created.push(`list ${name}`);
      }
      return { siteUrl, created };
    },

    /** The "Client Upload" SharePoint site group (created empty; permissions are scoped later). */
    async ensureClientUploadGroup(code: string): Promise<EnsureResult> {
      requirePnp(config);
      const { siteUrl } = await requireSite(code);
      if (await client.getSiteGroup(siteUrl, CLIENT_UPLOAD_GROUP)) return { siteUrl, created: [] };
      await client.createSiteGroup(siteUrl, CLIENT_UPLOAD_GROUP, `Client-side contributors for ${clSiteName(code)} (ClientDocs uploads).`);
      return { siteUrl, created: [`group ${CLIENT_UPLOAD_GROUP}`] };
    },
  };
}

export type ClFolders = ReturnType<typeof createClFolders>;

/** Production instance from env (PnP certificate + LMS app-only Graph token). */
export function defaultClFolders(env: Record<string, string | undefined> = process.env): ClFolders {
  const config = readSharePointConfig(env);
  return createClFolders({ client: defaultSharePointClient(config), config });
}

export const ensureClientSite = (code: string) => defaultClFolders().ensureClientSite(code);
export const ensureFyTree = (code: string, fy: string | Date, opts?: FyTreeOptions) => defaultClFolders().ensureFyTree(code, fy, opts);
export const ensureClientLists = (code: string) => defaultClFolders().ensureClientLists(code);
export const ensureClientUploadGroup = (code: string) => defaultClFolders().ensureClientUploadGroup(code);

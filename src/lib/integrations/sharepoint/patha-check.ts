// Path A gap check (read-only). Used by scripts/verify-patha.ts; never creates anything —
// it only calls the client's get/list methods. Each row says what is missing and the
// idempotent ensure-* call (or human action) that fixes it.
import { pnpBlockedAction, type SharePointConfig } from "./config";
import { BlockedError, GRAPH_BLOCKED_ACTION, GraphError } from "./errors";
import type { GraphSite, SharePointClient } from "./graph-client";
import {
  CL_SITE_PREFIX, CLIENT_LISTS, CLIENT_UPLOAD_GROUP, COMPLIANCE_LIBRARY, KINDS, SERVICES,
  clSiteName, clSiteUrl, isValidClientCode, isValidPeriod, normalizeFy, type FyLabel,
} from "./paths";

export const PARTNERS_GROUP_ID = "e5583268-4c8c-4abf-8b35-3ef1f0d37a78";
export const STAFF_GROUP_ID = "67ed1191-302b-495a-913b-b93cc6ee118d";

export type CheckStatus = "OK" | "GAP" | "BLOCKED" | "ERROR";
export interface CheckRow { scope: string; check: string; status: CheckStatus; detail: string }

export interface PathACheckInput {
  client: SharePointClient;
  config: SharePointConfig;
  codes: string[];
  fys: Array<string | Date>;
  partnersGroupId?: string;
  staffGroupId?: string;
}

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
const ok = (scope: string, check: string, detail = ""): CheckRow => ({ scope, check, status: "OK", detail });
const gap = (scope: string, check: string, detail: string): CheckRow => ({ scope, check, status: "GAP", detail });

/** Maps a thrown error to a BLOCKED (credentials/consent) or ERROR row. Never to OK. */
export function errorRow(scope: string, check: string, e: unknown): CheckRow {
  if (e instanceof BlockedError) return { scope, check, status: "BLOCKED", detail: e.action };
  if (e instanceof GraphError && (e.status === 401 || e.status === 403)) {
    return {
      scope,
      check,
      status: "BLOCKED",
      detail: `HTTP ${e.status} — grant admin consent: Graph Sites.Read.All + Group.Read.All (LMS app) / SharePoint Sites.FullControl.All (PnP app).`,
    };
  }
  return { scope, check, status: "ERROR", detail: (e as Error).message.slice(0, 200) };
}

async function row(scope: string, check: string, fn: () => Promise<CheckRow>): Promise<CheckRow> {
  try {
    return await fn();
  } catch (e) {
    return errorRow(scope, check, e);
  }
}

/** Client codes of CL- sites on the tenant host, from a Graph site search. */
export function discoverClientCodes(sites: GraphSite[], host: string): string[] {
  const codes = new Set<string>();
  for (const s of sites) {
    let u: URL;
    try {
      u = new URL(s.webUrl);
    } catch {
      continue;
    }
    if (u.host.toLowerCase() !== host.toLowerCase()) continue;
    const m = /^\/sites\/([^/]+)\/?$/.exec(u.pathname);
    if (!m || !m[1].startsWith(CL_SITE_PREFIX)) continue;
    const code = m[1].slice(CL_SITE_PREFIX.length);
    if (isValidClientCode(code)) codes.add(code);
  }
  return [...codes].sort();
}

const preview = (paths: string[]) => `${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ` … (+${paths.length - 5} more)` : ""}`;

async function checkFyTree(client: SharePointClient, driveId: string, fy: FyLabel): Promise<string[]> {
  const missing: string[] = [];
  const root = new Set((await client.listChildren(driveId, "")).map((c) => c.name));
  if (!root.has(fy)) return [fy];
  const services = new Set((await client.listChildren(driveId, fy)).map((c) => c.name));
  for (const svc of SERVICES) {
    if (!services.has(svc)) {
      missing.push(`${fy}/${svc}`);
      continue;
    }
    // Period folders are created as needed; every period present must carry all three kinds.
    for (const p of await client.listChildren(driveId, `${fy}/${svc}`)) {
      if (!isValidPeriod(p.name)) continue;
      const kinds = new Set((await client.listChildren(driveId, `${fy}/${svc}/${p.name}`)).map((c) => c.name));
      for (const k of KINDS) if (!kinds.has(k)) missing.push(`${fy}/${svc}/${p.name}/${k}`);
    }
  }
  return missing;
}

export async function runPathACheck(input: PathACheckInput): Promise<CheckRow[]> {
  const { client, config } = input;
  const spBlocked = config.pnp ? null : pnpBlockedAction(config.pnpMissing);
  const blocked = (scope: string, check: string): CheckRow => ({ scope, check, status: "BLOCKED", detail: spBlocked! });
  const fys = input.fys.map((f) => normalizeFy(f));
  const rows: CheckRow[] = [];
  const hubScope = "Hub";

  rows.push(
    await row(hubScope, "Hub site exists", async () =>
      (await client.getSiteByUrl(config.hubSiteUrl)) ? ok(hubScope, "Hub site exists", config.hubSiteUrl) : gap(hubScope, "Hub site exists", `Create communication site ${config.hubSiteUrl}`),
    ),
  );
  let hubId: string | null = null;
  if (spBlocked) rows.push(blocked(hubScope, "Registered as hub site"));
  else {
    rows.push(
      await row(hubScope, "Registered as hub site", async () => {
        const info = await client.getSiteInfo(config.hubSiteUrl);
        if (!info?.IsHubSite) return gap(hubScope, "Registered as hub site", "SharePoint admin center → Active sites → Indefine-Compliance → Hub → Register as hub site");
        hubId = info.HubSiteId && info.HubSiteId !== ZERO_GUID ? info.HubSiteId : info.Id;
        return ok(hubScope, "Registered as hub site", hubId);
      }),
    );
  }
  for (const [label, id] of [["Partners", input.partnersGroupId ?? PARTNERS_GROUP_ID], ["Staff", input.staffGroupId ?? STAFF_GROUP_ID]] as const) {
    rows.push(
      await row("Entra", `${label} group`, async () => {
        const g = await client.getGroup(id);
        return g ? ok("Entra", `${label} group`, `${g.displayName} (${id})`) : gap("Entra", `${label} group`, `Group ${id} not found in Entra ID`);
      }),
    );
  }

  if (input.codes.length === 0) rows.push(gap("CL- sites", "Client sites found", "No CL-{Code} sites found and none given (--codes)."));

  for (const code of input.codes) {
    const scope = isValidClientCode(code) ? clSiteName(code) : `CL-${code}`;
    if (!isValidClientCode(code)) {
      rows.push(gap(scope, "Valid client code", `"${code}" breaks the code rule (A–Z0–9, 3–10 chars); fix FirmClient.clientCode`));
      continue;
    }
    const siteUrl = clSiteUrl(code, config.tenantHost);
    let site: GraphSite | null = null;
    const siteRow = await row(scope, "Site exists", async () => {
      site = await client.getSiteByUrl(siteUrl);
      return site ? ok(scope, "Site exists", siteUrl) : gap(scope, "Site exists", `ensureClientSite("${code}") — all per-site objects are missing too`);
    });
    rows.push(siteRow);
    if (!site) continue;
    const siteId = (site as GraphSite).id;

    if (spBlocked) rows.push(blocked(scope, "Joined to hub"));
    else {
      rows.push(
        await row(scope, "Joined to hub", async () => {
          const info = await client.getSiteInfo(siteUrl);
          if (hubId && info && info.HubSiteId.toLowerCase() === hubId.toLowerCase()) return ok(scope, "Joined to hub");
          return gap(scope, "Joined to hub", `ensureClientSite("${code}") joins ${config.hubSiteUrl}`);
        }),
      );
    }

    let driveId: string | null = null;
    rows.push(
      await row(scope, `${COMPLIANCE_LIBRARY} library`, async () => {
        driveId = (await client.getDriveByName(siteId, COMPLIANCE_LIBRARY))?.id ?? null;
        return driveId ? ok(scope, `${COMPLIANCE_LIBRARY} library`) : gap(scope, `${COMPLIANCE_LIBRARY} library`, `ensureFyTree("${code}", fy) creates it`);
      }),
    );
    for (const fy of fys) {
      const check = `FY tree ${fy}`;
      if (!driveId) {
        rows.push(gap(scope, check, `Library missing — ensureFyTree("${code}", "${fy}")`));
        continue;
      }
      const d: string = driveId;
      rows.push(
        await row(scope, check, async () => {
          const missing = await checkFyTree(client, d, fy);
          return missing.length === 0 ? ok(scope, check) : gap(scope, check, `${missing.length} missing: ${preview(missing)} — ensureFyTree("${code}", "${fy}")`);
        }),
      );
    }
    for (const list of CLIENT_LISTS) {
      rows.push(
        await row(scope, `${list} list`, async () =>
          (await client.getList(siteId, list)) ? ok(scope, `${list} list`) : gap(scope, `${list} list`, `ensureClientLists("${code}")`),
        ),
      );
    }
    if (spBlocked) rows.push(blocked(scope, `${CLIENT_UPLOAD_GROUP} group`));
    else {
      rows.push(
        await row(scope, `${CLIENT_UPLOAD_GROUP} group`, async () =>
          (await client.getSiteGroup(siteUrl, CLIENT_UPLOAD_GROUP))
            ? ok(scope, `${CLIENT_UPLOAD_GROUP} group`)
            : gap(scope, `${CLIENT_UPLOAD_GROUP} group`, `ensureClientUploadGroup("${code}")`),
        ),
      );
    }
  }
  return rows;
}

/** 0 = no gaps, 1 = gaps, 2 = blocked or errored (cannot certify; never a pass). */
export function exitCodeFor(rows: CheckRow[]): 0 | 1 | 2 {
  if (rows.length === 0 || rows.some((r) => r.status === "BLOCKED" || r.status === "ERROR")) return 2;
  return rows.some((r) => r.status === "GAP") ? 1 : 0;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function formatGapTable(rows: CheckRow[], meta: { generatedAt: string; fys: string[] }): string {
  const count = (s: CheckStatus) => rows.filter((r) => r.status === s).length;
  const lines = [
    `## Path A gap check — ${meta.generatedAt}`,
    "",
    `FY checked: ${meta.fys.join(", ") || "–"} · OK ${count("OK")} · GAP ${count("GAP")} · BLOCKED ${count("BLOCKED")} · ERROR ${count("ERROR")} · exit ${exitCodeFor(rows)}`,
    "",
    "| Scope | Check | Status | Detail / fix |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${cell(r.scope)} | ${cell(r.check)} | ${r.status} | ${cell(r.detail)} |`),
  ];
  return `${lines.join("\n")}\n`;
}

export interface PathAArgs { out: string | null; codes: string[] | null; fys: string[]; help: boolean }

/** `--out file`, `--codes A,B`, `--fy 2026-27` (repeatable or comma-separated), `--help`. */
export function parsePathAArgs(argv: string[]): PathAArgs {
  const args: PathAArgs = { out: null, codes: null, fys: [], help: false };
  const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--codes") args.codes = list(argv[++i]);
    else if (a === "--fy") args.fys.push(...list(argv[++i]));
    else throw new Error(`Unknown argument "${a}"`);
  }
  return args;
}

/** Human actions needed before a live run can say anything; empty when Graph can be called. */
export function preflightBlocked(env: Record<string, string | undefined>, config: SharePointConfig): string[] {
  const actions: string[] = [];
  if (!env.MS_TENANT_ID || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) actions.push(GRAPH_BLOCKED_ACTION);
  if (actions.length && !config.pnp) actions.push(pnpBlockedAction(config.pnpMissing));
  return actions;
}

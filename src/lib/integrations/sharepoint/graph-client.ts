// Thin, injectable Graph + SharePoint REST client for Path A. Read and create/ensure
// operations only: there is deliberately no delete, move, rename or update method, and the
// internal request helper accepts only GET and POST (Never-delete rule, ORCHESTRATOR #2).
// File bytes are the one exception Graph forces: content upload is an HTTP PUT. It lives in a
// single helper (putContent) that is only ever given a `:/content?...conflictBehavior=fail` URL
// or the URL of an upload session created with conflictBehavior "fail", so an existing file is
// never overwritten (409 -> ConflictError). no-destructive.test.ts pins this down.
// Transport and token providers are injected so tests run against an in-memory fake.
// Throttling (429) and server errors (5xx) are retried a bounded number of times,
// honouring Retry-After. Several independent reads go out as one Graph JSON batch (POST /$batch
// whose sub-requests are GETs only; batchGet). Item reads ask for ITEM_SELECT fields only.
//
// Credentials go only where they belong (security re-audit NEW-3): the app-only Graph token only to
// https://graph.microsoft.com (isGraphUrl) — so an @odata.nextLink pointing anywhere else is refused,
// not followed —, a SharePoint REST token only to the https *.sharepoint.com host it was minted for,
// and upload-session bytes only to an https Microsoft host (graph.microsoft.com or *.sharepoint.com).
// A refused request throws UnsafeUrlError before anything is sent.
import { createHash } from "node:crypto";
import { isGraphUrl } from "@/lib/hardening/net";
import { BlockedError, ConflictError, GRAPH_BLOCKED_ACTION, GraphError, UnsafeUrlError } from "./errors";
import type { FetchLike } from "./sp-auth";

export type { FetchLike } from "./sp-auth";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphSite { id: string; webUrl: string; displayName?: string; name?: string }
export interface GraphDrive { id: string; name: string; webUrl?: string; driveType?: string }
export interface GraphList { id: string; displayName: string; name?: string; webUrl?: string; list?: { template?: string } }
/** Content hashes Graph reports. SharePoint libraries give quickXorHash only; sha1/sha256 appear on some drives. */
export interface GraphFileHashes { quickXorHash?: string; sha1Hash?: string; sha256Hash?: string }
export interface GraphItem {
  id: string;
  name: string;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string; hashes?: GraphFileHashes };
  size?: number;
  /** Content tag: changes whenever the file's content changes (not for metadata-only edits). Files only. */
  cTag?: string;
}

/** The driveItem fields this client reads; every item GET asks for these only ($select). */
export const ITEM_SELECT = "id,name,size,webUrl,cTag,file,folder";
/** Graph JSON batching takes at most 20 requests per batch. */
export const BATCH_MAX = 20;

/** Uploads never overwrite: "fail" is the only conflict behaviour the client accepts. */
export interface UploadOptions { conflict: "fail" }
export interface CopyResult { item: GraphItem; sha256: string; sizeBytes: number }

/** Files up to this size go in one request; larger files use an upload session. */
export const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Upload-session chunk: a multiple of 320 KiB, as Graph requires. */
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10;
export interface GraphGroup { id: string; displayName: string }

export type ColumnDefinition =
  | { name: string; text: Record<string, never> }
  | { name: string; dateTime: { format?: "dateOnly" | "dateTime" } }
  | { name: string; choice: { choices: string[] } }
  | { name: string; number: Record<string, never> };

export interface ListDefinition {
  displayName: string;
  template: "genericList" | "documentLibrary";
  columns?: ColumnDefinition[];
}

/** SPSiteManager status: 0 not found, 1 provisioning, 2 ready, 3 error. */
export interface SiteCreationStatus { SiteId?: string; SiteStatus: 0 | 1 | 2 | 3; SiteUrl?: string }
export interface SpSiteInfo { Id: string; HubSiteId: string; IsHubSite: boolean }
export interface SpSiteGroup { Id: number; Title: string }

export interface CommunicationSiteRequest {
  Title: string;
  Url: string;
  Owner: string;
  Description?: string;
  Lcid?: number;
}

export interface SharePointClient {
  // ---- Graph: read ----
  getSiteByUrl(siteUrl: string): Promise<GraphSite | null>;
  searchSites(query: string): Promise<GraphSite[]>;
  getGroup(groupId: string): Promise<GraphGroup | null>;
  listDrives(siteId: string): Promise<GraphDrive[]>;
  getDriveByName(siteId: string, name: string): Promise<GraphDrive | null>;
  listLists(siteId: string): Promise<GraphList[]>;
  getList(siteId: string, displayName: string): Promise<GraphList | null>;
  getItemByPath(driveId: string, path: string): Promise<GraphItem | null>;
  listChildren(driveId: string, path: string): Promise<GraphItem[]>;
  /**
   * Children of several folders in Graph JSON batches (≤ 20 GETs per request); null for a folder
   * that does not exist. Throttled sub-requests are retried after their Retry-After.
   */
  listChildrenMany(driveId: string, paths: string[]): Promise<(GraphItem[] | null)[]>;
  /** File bytes, or null when there is no item at `path`. */
  downloadFile(driveId: string, path: string): Promise<Buffer | null>;
  // ---- Graph: file content (create-only, conflict "fail": never overwrites) ----
  uploadFile(driveId: string, path: string, content: Uint8Array, opts: UploadOptions): Promise<GraphItem>;
  /** Download + upload (so the copy's sha256 is known). Throws ConflictError if `toPath` exists. */
  copyItem(driveId: string, fromPath: string, toPath: string, opts: UploadOptions): Promise<CopyResult>;
  // ---- Graph: create (idempotent on conflict) ----
  createFolder(driveId: string, parentPath: string, name: string): Promise<{ item: GraphItem; created: boolean }>;
  createList(siteId: string, def: ListDefinition): Promise<{ list: GraphList; created: boolean }>;
  // ---- SharePoint REST: read ----
  getSiteCreationStatus(tenantHost: string, siteUrl: string): Promise<SiteCreationStatus>;
  getSiteInfo(siteUrl: string): Promise<SpSiteInfo | null>;
  getSiteGroup(siteUrl: string, title: string): Promise<SpSiteGroup | null>;
  // ---- SharePoint REST: create ----
  createCommunicationSite(tenantHost: string, req: CommunicationSiteRequest): Promise<SiteCreationStatus>;
  joinHubSite(siteUrl: string, hubSiteId: string): Promise<void>;
  createSiteGroup(siteUrl: string, title: string, description: string): Promise<SpSiteGroup>;
}

export interface ClientOptions {
  /** fetch-compatible transport. Default: global fetch. */
  fetch?: FetchLike;
  /** Graph bearer token, or null when not configured. Default: getAppOnlyToken from @/lib/graph. */
  graphToken?: () => Promise<string | null>;
  /** SharePoint-resource token for a tenant host. Default: none (SharePoint REST calls throw BlockedError). */
  sharePointToken?: (host: string) => Promise<string>;
  /** Blocked action reported when sharePointToken is absent. */
  sharePointBlockedAction?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  graphBase?: string;
}

type Method = "GET" | "POST";
/** Graph's verb for file bytes. Used by putContent only (see the header comment). */
const UPLOAD_VERB = "PUT" as const;
type Auth = { kind: "graph" } | { kind: "sp"; host: string };

const defaultGraphToken = async () => (await import("@/lib/graph")).getAppOnlyToken();
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry-After as milliseconds (delta-seconds or HTTP-date), or null when absent/unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The URL parsed, or null when it is not an https URL without user info. */
function httpsUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname ? u : null;
  } catch {
    return null;
  }
}
const hostOf = (url: string) => httpsUrl(url)?.host ?? "";
const SHAREPOINT_HOST = /^[a-z0-9-]+\.sharepoint\.com$/i;

/** May this request carry the credential `auth` names? Graph: graph.microsoft.com; SharePoint REST: its own *.sharepoint.com host. */
export function tokenMayGoTo(url: string, auth: { kind: "graph" } | { kind: "sp"; host: string }): boolean {
  if (auth.kind === "graph") return isGraphUrl(url);
  const u = httpsUrl(url);
  return !!u && SHAREPOINT_HOST.test(u.host) && u.host.toLowerCase() === auth.host.toLowerCase();
}

/** An upload session URL Graph returned: https on graph.microsoft.com or a *.sharepoint.com host. */
export function isUploadSessionUrl(url: string): boolean {
  const u = httpsUrl(url);
  return !!u && (isGraphUrl(url) || SHAREPOINT_HOST.test(u.host));
}

const encPath = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
/** SharePoint REST string literal inside ('...'): single quotes are doubled. */
const spLiteral = (s: string) => s.replace(/'/g, "''");

export function createSharePointClient(opts: ClientOptions = {}): SharePointClient {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const graphToken = opts.graphToken ?? defaultGraphToken;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const maxRetries = opts.maxRetries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const graphBase = opts.graphBase ?? GRAPH_BASE;

  // Concurrent requests share one token fetch (the providers cache tokens until near expiry).
  let pendingGraphToken: Promise<string | null> | null = null;
  const graphTokenOnce = () => (pendingGraphToken ??= graphToken().finally(() => (pendingGraphToken = null)));

  async function bearer(auth: Auth): Promise<string> {
    if (auth.kind === "graph") {
      const t = await graphTokenOnce();
      if (!t) throw new BlockedError(GRAPH_BLOCKED_ACTION);
      return t;
    }
    if (!opts.sharePointToken) {
      // plain-messages: for IT — the certificate settings by name. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
      throw new BlockedError(opts.sharePointBlockedAction ?? "Configure the PnP certificate (SP_PNP_CERT_KEY_PEM + SP_PNP_CERT_PEM) for SharePoint REST.");
    }
    return opts.sharePointToken(auth.host);
  }

  /** One logical request with bounded retries. Returns the final Response (ok or not). */
  async function send(method: Method, url: string, auth: Auth, body?: unknown): Promise<Response> {
    if (!tokenMayGoTo(url, auth)) throw new UnsafeUrlError(hostOf(url), auth.kind === "graph" ? "the Microsoft Graph token" : "the SharePoint token");
    const token = await bearer(auth);
    const headers: Record<string, string> =
      auth.kind === "graph"
        ? { Authorization: `Bearer ${token}`, Accept: "application/json" }
        : { Authorization: `Bearer ${token}`, Accept: "application/json;odata=nometadata" };
    if (body !== undefined) headers["Content-Type"] = auth.kind === "graph" ? "application/json" : "application/json;odata=nometadata";
    return withRetries(() =>
      doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  }

  /** Bounded retries around one HTTP exchange: network errors, 429 and 5xx (Retry-After honoured). */
  async function withRetries(exchange: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await exchange();
      } catch (e) {
        if (attempt >= maxRetries) throw e;
        await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay));
        continue;
      }
      if (!isRetryable(res.status) || attempt >= maxRetries) return res;
      const ra = parseRetryAfter(res.headers.get("Retry-After"), now());
      await sleep(Math.min(ra ?? baseDelay * 2 ** attempt, maxDelay));
    }
  }

  /**
   * File bytes. Only two kinds of URL ever reach here: a simple-upload URL from uploadUrlFor()
   * (always `?@microsoft.graph.conflictBehavior=fail`) or the uploadUrl of a session created with
   * conflictBehavior "fail". Session URLs are pre-authenticated, so no bearer token is sent to them.
   */
  async function putContent(url: string, bytes: Uint8Array, extraHeaders: Record<string, string>, withBearer: boolean): Promise<Response> {
    if (withBearer ? !tokenMayGoTo(url, { kind: "graph" }) : !isUploadSessionUrl(url)) {
      throw new UnsafeUrlError(hostOf(url), withBearer ? "the Microsoft Graph token" : "file contents");
    }
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream", ...extraHeaders };
    if (withBearer) headers.Authorization = `Bearer ${await bearer({ kind: "graph" })}`;
    return withRetries(() =>
      doFetch(url, { method: UPLOAD_VERB, headers, body: bytes as unknown as BodyInit, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }),
    );
  }

  async function json<T>(method: Method, url: string, auth: Auth, body?: unknown): Promise<T> {
    const res = await send(method, url, auth, body);
    if (!res.ok) throw new GraphError(res.status, method, url, await res.text());
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** GET that maps 404 to null. */
  async function getOrNull<T>(url: string, auth: Auth): Promise<T | null> {
    const res = await send("GET", url, auth);
    if (res.status === 404) return null;
    if (!res.ok) throw new GraphError(res.status, "GET", url, await res.text());
    return (await res.json()) as T;
  }

  /** GET every page of a Graph collection. */
  async function getAll<T>(url: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = url;
    while (next) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await json("GET", next, { kind: "graph" });
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }

  type BatchResponse = { id: string; status: number; headers?: Record<string, string>; body?: unknown };

  /**
   * GETs in Graph JSON batches (POST /$batch carrying only GET sub-requests, ≤ BATCH_MAX each).
   * Returns each body, or null for a 404. A throttled (429) or failing (5xx) sub-request is retried
   * in the next batch after the largest Retry-After (bounded like single requests); any other
   * status throws GraphError. Note: Graph still counts every sub-request against throttling limits —
   * batching saves round trips and latency, not quota.
   */
  async function batchGet(urls: string[]): Promise<(unknown | null)[]> {
    const out: (unknown | null)[] = new Array(urls.length).fill(null);
    for (let start = 0; start < urls.length; start += BATCH_MAX) {
      let pending = urls.slice(start, start + BATCH_MAX).map((url, i) => ({ id: String(start + i), url }));
      for (let attempt = 0; pending.length; attempt++) {
        const requests = pending.map((p) => ({ id: p.id, method: "GET" as const, url: p.url.slice(graphBase.length) }));
        const { responses = [] } = await json<{ responses?: BatchResponse[] }>("POST", `${graphBase}/$batch`, G, { requests });
        const retry: typeof pending = [];
        let wait = 0;
        for (const p of pending) {
          const r = responses.find((x) => x.id === p.id);
          if (r && r.status >= 200 && r.status < 300) out[Number(p.id)] = r.body ?? {};
          else if (r && r.status === 404) out[Number(p.id)] = null;
          else if ((!r || isRetryable(r.status)) && attempt < maxRetries) {
            retry.push(p);
            const ra = r ? Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === "retry-after")?.[1] ?? null : null;
            wait = Math.max(wait, parseRetryAfter(ra, now()) ?? baseDelay * 2 ** attempt);
          } else throw new GraphError(r?.status ?? 502, "GET", p.url, r ? JSON.stringify(r.body ?? "") : "missing from the batch response");
        }
        pending = retry;
        if (pending.length) await sleep(Math.min(wait, maxDelay));
      }
    }
    return out;
  }

  const G = { kind: "graph" } as const;
  const spHost = (url: string): Auth => ({ kind: "sp", host: new URL(url).host });
  const itemUrl = (driveId: string, path: string) => {
    const p = encPath(path);
    return p ? `${graphBase}/drives/${driveId}/root:/${p}` : `${graphBase}/drives/${driveId}/root`;
  };
  /** Simple-upload target. conflictBehavior=fail is part of the URL, never a parameter. */
  const uploadUrlFor = (driveId: string, path: string) => `${itemUrl(driveId, path)}:/content?@microsoft.graph.conflictBehavior=fail`;
  const childrenUrl = (driveId: string, path: string) => {
    const p = encPath(path);
    return p ? `${graphBase}/drives/${driveId}/root:/${p}:/children` : `${graphBase}/drives/${driveId}/root/children`;
  };

  const client: SharePointClient = {
    async getSiteByUrl(siteUrl) {
      const u = new URL(siteUrl);
      return getOrNull<GraphSite>(`${graphBase}/sites/${u.host}:${u.pathname.replace(/\/+$/, "")}`, G);
    },
    searchSites(query) {
      return getAll<GraphSite>(`${graphBase}/sites?search=${encodeURIComponent(query)}&$select=id,webUrl,displayName,name`);
    },
    getGroup(groupId) {
      return getOrNull<GraphGroup>(`${graphBase}/groups/${encodeURIComponent(groupId)}?$select=id,displayName`, G);
    },
    listDrives(siteId) {
      return getAll<GraphDrive>(`${graphBase}/sites/${siteId}/drives?$select=id,name,webUrl,driveType`);
    },
    async getDriveByName(siteId, name) {
      return (await client.listDrives(siteId)).find((d) => d.name === name) ?? null;
    },
    listLists(siteId) {
      return getAll<GraphList>(`${graphBase}/sites/${siteId}/lists?$select=id,displayName,name,webUrl,list`);
    },
    async getList(siteId, displayName) {
      const want = displayName.toLowerCase();
      return (await client.listLists(siteId)).find((l) => l.displayName.toLowerCase() === want || l.name?.toLowerCase() === want) ?? null;
    },
    getItemByPath(driveId, path) {
      return getOrNull<GraphItem>(`${itemUrl(driveId, path)}?$select=${ITEM_SELECT}`, G);
    },
    listChildren(driveId, path) {
      return getAll<GraphItem>(`${childrenUrl(driveId, path)}?$select=${ITEM_SELECT}&$top=200`);
    },
    async listChildrenMany(driveId, paths) {
      const pages = await batchGet(paths.map((p) => `${childrenUrl(driveId, p)}?$select=${ITEM_SELECT}&$top=200`));
      const out: (GraphItem[] | null)[] = [];
      for (const page of pages as ({ value?: GraphItem[]; "@odata.nextLink"?: string } | null)[]) {
        if (!page) {
          out.push(null);
          continue;
        }
        const items = [...(page.value ?? [])];
        if (page["@odata.nextLink"]) items.push(...(await getAll<GraphItem>(page["@odata.nextLink"])));
        out.push(items);
      }
      return out;
    },
    async downloadFile(driveId, path) {
      const url = `${itemUrl(driveId, path)}:/content`;
      const res = await send("GET", url, G);
      if (res.status === 404) return null;
      if (!res.ok) throw new GraphError(res.status, "GET", url, await res.text());
      return Buffer.from(await res.arrayBuffer());
    },
    async uploadFile(driveId, path, content, opts) {
      if (opts?.conflict !== "fail") throw new Error("uploadFile only supports conflict 'fail' (files are never overwritten)");
      if (!encPath(path) || path.endsWith("/")) throw new Error(`uploadFile needs a file path, got "${path}"`);
      if (content.byteLength <= SIMPLE_UPLOAD_MAX_BYTES) {
        const url = uploadUrlFor(driveId, path);
        const res = await putContent(url, content, {}, true);
        if (res.status === 409) throw new ConflictError(path);
        if (!res.ok) throw new GraphError(res.status, UPLOAD_VERB, url, await res.text());
        return (await res.json()) as GraphItem;
      }
      const sessionUrl = `${itemUrl(driveId, path)}:/createUploadSession`;
      const created = await send("POST", sessionUrl, G, { item: { "@microsoft.graph.conflictBehavior": "fail" } });
      if (created.status === 409) throw new ConflictError(path);
      if (!created.ok) throw new GraphError(created.status, "POST", sessionUrl, await created.text());
      const { uploadUrl } = (await created.json()) as { uploadUrl: string };
      const total = content.byteLength;
      let last: Response | null = null;
      for (let start = 0; start < total; start += UPLOAD_CHUNK_BYTES) {
        const end = Math.min(start + UPLOAD_CHUNK_BYTES, total) - 1;
        last = await putContent(uploadUrl, content.subarray(start, end + 1), { "Content-Range": `bytes ${start}-${end}/${total}` }, false);
        if (last.status === 409) throw new ConflictError(path);
        // The session URL carries its own credential: never put it in an error message.
        if (!last.ok) throw new GraphError(last.status, UPLOAD_VERB, `upload session for ${path}`, await last.text());
      }
      return (await (last as Response).json()) as GraphItem;
    },
    async copyItem(driveId, fromPath, toPath, opts) {
      const bytes = await client.downloadFile(driveId, fromPath);
      if (!bytes) throw new GraphError(404, "GET", fromPath, "copy source not found");
      const item = await client.uploadFile(driveId, toPath, bytes, opts);
      return { item, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
    },
    async createFolder(driveId, parentPath, name) {
      const url = childrenUrl(driveId, parentPath);
      const res = await send("POST", url, G, { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
      if (res.status === 409) {
        const existing = await client.getItemByPath(driveId, `${parentPath}/${name}`);
        if (existing) return { item: existing, created: false };
      }
      if (!res.ok) throw new GraphError(res.status, "POST", url, await res.text());
      return { item: (await res.json()) as GraphItem, created: true };
    },
    async createList(siteId, def) {
      const url = `${graphBase}/sites/${siteId}/lists`;
      const res = await send("POST", url, G, { displayName: def.displayName, columns: def.columns ?? [], list: { template: def.template } });
      if (res.status === 409) {
        const existing = await client.getList(siteId, def.displayName);
        if (existing) return { list: existing, created: false };
      }
      if (!res.ok) throw new GraphError(res.status, "POST", url, await res.text());
      return { list: (await res.json()) as GraphList, created: true };
    },
    getSiteCreationStatus(tenantHost, siteUrl) {
      return json<SiteCreationStatus>(
        "GET",
        `https://${tenantHost}/_api/SPSiteManager/status?url='${encodeURIComponent(spLiteral(siteUrl))}'`,
        { kind: "sp", host: tenantHost },
      );
    },
    getSiteInfo(siteUrl) {
      return getOrNull<SpSiteInfo>(`${siteUrl}/_api/site?$select=Id,HubSiteId,IsHubSite`, spHost(siteUrl));
    },
    getSiteGroup(siteUrl, title) {
      return getOrNull<SpSiteGroup>(
        `${siteUrl}/_api/web/sitegroups/getbyname('${encodeURIComponent(spLiteral(title))}')?$select=Id,Title`,
        spHost(siteUrl),
      );
    },
    createCommunicationSite(tenantHost, req) {
      return json<SiteCreationStatus>("POST", `https://${tenantHost}/_api/SPSiteManager/create`, { kind: "sp", host: tenantHost }, {
        request: {
          Title: req.Title,
          Url: req.Url,
          Owner: req.Owner,
          Description: req.Description ?? "",
          Lcid: req.Lcid ?? 1033,
          WebTemplate: "SITEPAGEPUBLISHING#0", // communication site
          ShareByEmailEnabled: false,
        },
      });
    },
    async joinHubSite(siteUrl, hubSiteId) {
      await json<unknown>("POST", `${siteUrl}/_api/site/JoinHubSite('${encodeURIComponent(spLiteral(hubSiteId))}')`, spHost(siteUrl));
    },
    createSiteGroup(siteUrl, title, description) {
      return json<SpSiteGroup>("POST", `${siteUrl}/_api/web/sitegroups`, spHost(siteUrl), { Title: title, Description: description });
    },
  };
  return client;
}

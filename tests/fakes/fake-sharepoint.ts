// In-memory fake of the Graph + SharePoint REST endpoints the Path A client uses.
// Implements a fetch-compatible transport so the real graph-client code runs end to end
// in tests without any network. Only GET and POST exist; any other verb is answered 405
// and recorded in `violations` (tests assert it stays empty).

type Item = { id: string; name: string };
type Drive = { id: string; name: string; items: Map<string, Item> }; // key: "a/b/c" ("" = root)
type List = { id: string; displayName: string; template: string; columns: unknown[] };
type SiteGroup = { Id: number; Title: string };
type Site = {
  id: string;
  webUrl: string;
  name: string;
  hubSiteId: string;
  isHub: boolean;
  drives: Map<string, Drive>;
  lists: Map<string, List>;
  groups: Map<string, SiteGroup>;
};

export interface Call { method: string; url: string }

const ZERO = "00000000-0000-0000-0000-000000000000";
const GRAPH = "https://graph.microsoft.com/v1.0";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export class FakeSharePoint {
  readonly host: string;
  readonly sites = new Map<string, Site>(); // key: lower-case site URL
  readonly entraGroups = new Map<string, string>(); // id → displayName
  readonly calls: Call[] = [];
  readonly violations: Call[] = [];
  /** Responses served before normal handling (for throttling / outage tests). */
  readonly queued: Array<() => Response> = [];
  /** SPSiteManager/status polls a new site reports "provisioning" before "ready". */
  provisionPolls = 0;
  private seq = 0;
  private pendingSites = new Map<string, number>();

  constructor(host = "srcaassociate.sharepoint.com") {
    this.host = host;
  }

  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  // ---------------- seeding ----------------

  addSite(path: string, opts: { isHub?: boolean; hubSiteId?: string } = {}): Site {
    const webUrl = `https://${this.host}${path}`;
    const id = this.id("site");
    const site: Site = {
      id,
      webUrl,
      name: path.split("/").pop()!,
      hubSiteId: opts.isHub ? id : opts.hubSiteId ?? ZERO,
      isHub: !!opts.isHub,
      drives: new Map(),
      lists: new Map(),
      groups: new Map(),
    };
    const docs = this.newDrive("Documents");
    site.drives.set(docs.id, docs);
    site.lists.set(docs.id, { id: docs.id, displayName: "Documents", template: "documentLibrary", columns: [] });
    this.sites.set(webUrl.toLowerCase(), site);
    return site;
  }

  addHub(path = "/sites/Indefine-Compliance"): Site {
    return this.addSite(path, { isHub: true });
  }

  addEntraGroup(id: string, displayName: string) {
    this.entraGroups.set(id, displayName);
  }

  site(path: string): Site | undefined {
    return this.sites.get(`https://${this.host}${path}`.toLowerCase());
  }

  addLibrary(site: Site, name: string): Drive {
    const d = this.newDrive(name);
    site.drives.set(d.id, d);
    site.lists.set(d.id, { id: d.id, displayName: name, template: "documentLibrary", columns: [] });
    return d;
  }

  addFolder(drive: Drive, path: string) {
    let cur = "";
    for (const seg of path.split("/").filter(Boolean)) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!drive.items.has(cur)) drive.items.set(cur, { id: this.id("item"), name: seg });
    }
  }

  drive(site: Site, name: string): Drive | undefined {
    return [...site.drives.values()].find((d) => d.name === name);
  }

  private newDrive(name: string): Drive {
    return { id: this.id("drive"), name, items: new Map([["", { id: this.id("root"), name: "root" }]]) };
  }

  // ---------------- inspection ----------------

  /** Calls that would change state (every POST). */
  get mutations(): Call[] {
    return this.calls.filter((c) => c.method === "POST");
  }

  /** Stable, comparable picture of all state. */
  snapshot() {
    return [...this.sites.values()]
      .map((s) => ({
        url: s.webUrl,
        hub: s.hubSiteId,
        isHub: s.isHub,
        lists: [...s.lists.values()].map((l) => `${l.displayName}:${l.template}`).sort(),
        groups: [...s.groups.keys()].sort(),
        drives: [...s.drives.values()]
          .map((d) => ({ name: d.name, items: [...d.items.keys()].sort() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.url.localeCompare(b.url));
  }

  // ---------------- transport ----------------

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const call = { method, url };
    this.calls.push(call);
    if (method !== "GET" && method !== "POST") {
      this.violations.push(call);
      return json(405, { error: "method not allowed in fake" });
    }
    const q = this.queued.shift();
    if (q) return q();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    try {
      return url.startsWith(GRAPH) ? this.graph(method, url.slice(GRAPH.length), body) : this.rest(method, url, body);
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  };

  private findSiteById(id: string) {
    return [...this.sites.values()].find((s) => s.id === id);
  }
  private findDrive(id: string) {
    for (const s of this.sites.values()) {
      const d = s.drives.get(id);
      if (d) return d;
    }
    return undefined;
  }

  private graph(method: string, pathAndQuery: string, body: Record<string, unknown> | undefined): Response {
    const [path, query = ""] = pathAndQuery.split("?");
    const params = new URLSearchParams(query);
    let m: RegExpExecArray | null;

    if ((m = /^\/sites\/([^/:]+):(\/sites\/[^/]+)$/.exec(path)) && method === "GET") {
      const site = this.sites.get(`https://${m[1]}${decodeURIComponent(m[2])}`.toLowerCase());
      return site ? json(200, { id: site.id, webUrl: site.webUrl, name: site.name, displayName: site.name }) : json(404, { error: "itemNotFound" });
    }
    if (path === "/sites" && method === "GET") {
      const q = (params.get("search") ?? "").toLowerCase();
      const value = [...this.sites.values()].filter((s) => s.name.toLowerCase().includes(q)).map((s) => ({ id: s.id, webUrl: s.webUrl, name: s.name }));
      return json(200, { value });
    }
    if ((m = /^\/groups\/([^/]+)$/.exec(path)) && method === "GET") {
      const name = this.entraGroups.get(decodeURIComponent(m[1]));
      return name ? json(200, { id: m[1], displayName: name }) : json(404, { error: "Request_ResourceNotFound" });
    }
    if ((m = /^\/sites\/([^/]+)\/drives$/.exec(path)) && method === "GET") {
      const site = this.findSiteById(m[1]);
      if (!site) return json(404, {});
      return json(200, { value: [...site.drives.values()].map((d) => ({ id: d.id, name: d.name })) });
    }
    if ((m = /^\/sites\/([^/]+)\/lists$/.exec(path))) {
      const site = this.findSiteById(m[1]);
      if (!site) return json(404, {});
      if (method === "GET") return json(200, { value: [...site.lists.values()].map((l) => ({ id: l.id, displayName: l.displayName, list: { template: l.template } })) });
      const displayName = String(body!.displayName);
      if ([...site.lists.values()].some((l) => l.displayName.toLowerCase() === displayName.toLowerCase())) return json(409, { error: "nameAlreadyExists" });
      const template = String((body!.list as { template: string }).template);
      let id = this.id("list");
      if (template === "documentLibrary") {
        const d = this.newDrive(displayName);
        site.drives.set(d.id, d);
        id = d.id;
      }
      const list = { id, displayName, template, columns: (body!.columns as unknown[]) ?? [] };
      site.lists.set(id, list);
      return json(201, { id, displayName, list: { template } });
    }
    if ((m = /^\/drives\/([^/]+)\/root(?::\/(.+?))?(:\/children|\/children)?$/.exec(path))) {
      const drive = this.findDrive(m[1]);
      if (!drive) return json(404, {});
      const rel = (m[2] ?? "").split("/").filter(Boolean).map(decodeURIComponent).join("/");
      const item = drive.items.get(rel);
      if (!m[3]) {
        if (method !== "GET") return json(400, {});
        return item ? json(200, { id: item.id, name: item.name, folder: {} }) : json(404, { error: "itemNotFound" });
      }
      if (!item) return json(404, { error: "itemNotFound" });
      if (method === "GET") {
        const prefix = rel ? `${rel}/` : "";
        const value = [...drive.items.entries()]
          .filter(([k]) => k !== "" && k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
          .map(([, v]) => ({ id: v.id, name: v.name, folder: {} }));
        return json(200, { value });
      }
      const name = String(body!.name);
      const key = rel ? `${rel}/${name}` : name;
      if (drive.items.has(key)) return json(409, { error: "nameAlreadyExists" });
      const created = { id: this.id("item"), name };
      drive.items.set(key, created);
      return json(201, { ...created, folder: {} });
    }
    return json(400, { error: `fake: unhandled Graph ${method} ${path}` });
  }

  private rest(method: string, url: string, body: Record<string, unknown> | undefined): Response {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    let m: RegExpExecArray | null;

    if (path === "/_api/SPSiteManager/create" && method === "POST") {
      const req = body!.request as { Url: string; Title: string; Owner: string };
      if (!req.Owner) return json(400, { error: "Owner required for app-only" });
      const key = req.Url.toLowerCase();
      if (this.sites.has(key)) return json(200, { SiteStatus: 2, SiteUrl: req.Url, SiteId: this.sites.get(key)!.id });
      this.addSite(new URL(req.Url).pathname);
      this.pendingSites.set(key, this.provisionPolls);
      return json(200, { SiteStatus: this.provisionPolls > 0 ? 1 : 2, SiteUrl: req.Url });
    }
    if (path === "/_api/SPSiteManager/status" && method === "GET") {
      const target = decodeURIComponent(u.searchParams.get("url") ?? "").replace(/^'|'$/g, "").toLowerCase();
      const left = this.pendingSites.get(target) ?? 0;
      if (left > 0) this.pendingSites.set(target, left - 1);
      return json(200, { SiteStatus: left > 1 ? 1 : this.sites.has(target) ? 2 : 0, SiteUrl: target });
    }
    const siteMatch = /^(\/sites\/[^/]+)(\/_api\/.*)$/.exec(path);
    if (!siteMatch) return json(400, { error: `fake: unhandled REST ${method} ${url}` });
    const site = this.sites.get(`https://${u.host}${siteMatch[1]}`.toLowerCase());
    if (!site) return json(404, { error: "site not found" });
    const api = siteMatch[2];

    if (api === "/_api/site" && method === "GET") return json(200, { Id: site.id, HubSiteId: site.hubSiteId, IsHubSite: site.isHub });
    if ((m = /^\/_api\/site\/JoinHubSite\('(.+)'\)$/.exec(api)) && method === "POST") {
      const hub = [...this.sites.values()].find((s) => s.isHub && s.id === m![1]);
      if (!hub) return json(400, { error: "not a hub" });
      site.hubSiteId = hub.id;
      return json(200, {});
    }
    if ((m = /^\/_api\/web\/sitegroups\/getbyname\('(.+)'\)$/.exec(api)) && method === "GET") {
      const g = site.groups.get(m[1].replace(/''/g, "'"));
      return g ? json(200, g) : json(404, { error: "Group cannot be found" });
    }
    if (api === "/_api/web/sitegroups" && method === "POST") {
      const title = String(body!.Title);
      if (site.groups.has(title)) return json(400, { error: "group exists" });
      const g = { Id: site.groups.size + 10, Title: title };
      site.groups.set(title, g);
      return json(201, g);
    }
    return json(400, { error: `fake: unhandled REST ${method} ${url}` });
  }
}

// Collectors for the portals the LMS server can reach directly (no Indian IP needed).
// Port of the statutory-updates skill's cloud_adapters.py — keep the two in step when
// a portal changes its site. Sources: e-filing news, Ministry of Labour, ICAI,
// cbic-gst.gov.in tickers, PT Karnataka, GST Council.
import { extractPdfText } from "@/lib/office-tools/pdf";
import { effDate, type RawItem } from "./portals";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept-Language": "en-IN,en;q=0.9",
};
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

async function get(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { ...init, headers: UA, signal: AbortSignal.timeout(40_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return r;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}
const getText = async (url: string) => (await get(url)).text();
const getJson = async <T = any>(url: string): Promise<T> => (await get(url)).json() as Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
export const clean = (s: string | null | undefined) => unescapeHtml((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** YYYY-MM-DD from common Indian portal formats; `order` applies to all-numeric dates. */
export function iso(s: unknown, order: "DMY" | "MDY" = "DMY"): string | null {
  if (!s) return null;
  const t = String(s);
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([A-Za-z]{3,9})[\s\-/.,]+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(+m[1])}`;
  m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(+m[2])}`;
  m = t.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    const [d, mo] = order === "MDY" ? [b, a] : [a, b];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/** All dates found in free text (ticker rows). */
function allDates(s: string): string[] {
  return [...s.matchAll(/\d{1,2}(?:st|nd|rd|th)?[\s\-/.,]+(?:[A-Za-z]{3,9}|\d{1,2})[\s\-/.,]+\d{4}/g)].map((m) => iso(m[0])).filter((d): d is string => !!d);
}

function item(o: Partial<RawItem> & { portal: string; title: string }): RawItem {
  return { section: null, doc_type: "Other", issue_date: null, upload_date: null, date_basis: "upload", url: null, alt_url: null, text: null, ...o };
}

// ------------------------------------------------------------ Income-tax e-filing portal
async function efiling(frm: string): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const base = "https://www.incometax.gov.in/iec/foportal/latest-news";
  for (let page = 0; page < 20; page++) {
    const s = await getText(base + (page ? `?page=%2C${page}` : "")); // Drupal 'pagerer' uses the 2nd pager slot: ?page=,N
    const rows = [...s.matchAll(/<div class="up-date">\s*([^<]+)<\/div>.*?<p>(.*?)<\/p>/gs)];
    if (!rows.length) break;
    let oldest: string | null = null;
    for (const [, d0, body] of rows) {
      const d = iso(d0);
      oldest = d;
      const link = body.match(/href="([^"]+)"/);
      const title = clean(body.replace(/Click here/g, ""));
      out.push(item({ portal: "Income Tax e-filing portal", section: "Latest News", doc_type: "News", title, upload_date: d, url: link ? link[1] : base }));
    }
    if (oldest && oldest < frm) break;
  }
  return uniq(out, (x) => `${x.title}|${x.upload_date}`);
}

// ------------------------------------------------------------ Ministry of Labour & Employment
const LAB = "https://www.labour.gov.in/cms/wp-json";
type Acf = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function labMedia(mid: number, cache: Map<number, string | null>): Promise<string | null> {
  if (cache.has(mid)) return cache.get(mid)!;
  // File ids in document posts are 'central_documents' post ids (PDF in acf_data.pdf.url); fall back to WP media.
  let url: string | null = null;
  try {
    const pdf = (await getJson(`${LAB}/post-page/post?id=${mid}`))?.posts?.acf_data?.pdf;
    url = pdf && typeof pdf === "object" ? pdf.url ?? null : null;
  } catch { /* fall through */ }
  if (!url) {
    try { url = (await getJson(`${LAB}/wp/v2/media/${mid}?_fields=source_url`)).source_url ?? null; } catch { url = null; }
  }
  cache.set(mid, url);
  return url;
}

/** [url, alt_url] for a Labour document's acf_data. */
async function labFile(acf: Acf | null, cache: Map<number, string | null>): Promise<[string | null, string | null]> {
  const files = acf?.file;
  if (Array.isArray(files) && files.length && typeof files[0] === "object" && files[0]) {
    const f = files[0];
    if (f.type === "Link" && f.external_link) {
      if (String(f.external_link).includes("egazette.gov.in/(S(")) return [null, null]; // session-bound eGazette URL - not shareable
      return [null, f.external_link];
    }
    if (Array.isArray(f.file) && f.file.length) return [await labMedia(f.file[0], cache), null];
  }
  if (Array.isArray(files) && files.length && typeof files[0] === "number") return [await labMedia(files[0], cache), null];
  if (acf?.pdf && typeof acf.pdf === "object") return [acf.pdf.url ?? null, null];
  return [null, null];
}

async function labour(frm: string): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const cache = new Map<number, string | null>();
  const portal = "Ministry of Labour & Employment";
  // What's New
  for (const p of (await getJson(`${LAB}/post-page/whats_new`)).posts ?? []) {
    const up = String(p.post_date).slice(0, 10);
    let url: string | null = null, alt: string | null = null, issue: string | null = null;
    const fid = (p.acf_data?.file ?? [null])[0];
    if (fid) {
      try {
        const dacf: Acf = (await getJson(`${LAB}/post-page/post?id=${fid}`)).posts?.acf_data ?? {};
        issue = iso(dacf.file_date || dacf.date);
        url = dacf.pdf && typeof dacf.pdf === "object" ? dacf.pdf.url ?? null : null;
        if (!url) [url, alt] = await labFile(dacf, cache);
      } catch { /* keep listing link */ }
    }
    out.push(item({ portal, section: "What's New", doc_type: "Notice", title: clean(p.post_title), issue_date: issue, upload_date: up, url: url || "https://www.labour.gov.in/whats-new", alt_url: alt }));
  }
  // Document categories (children roll up into parents)
  const cats: { slug: string; name: string; parent: number }[] = (await getJson(`${LAB}/taxonomy/documents_category`)).documents_category;
  const names = Object.fromEntries(cats.map((c) => [c.slug, c.name]));
  const dtype: Record<string, string> = { "press-release": "Press Release", "gazette-notifications": "Notification", guidelines: "Guideline", publications: "Publication", "acts-and-policy": "Act/Policy", reports: "Report", "orders-and-notices": "Order" };
  for (const slug of cats.filter((c) => c.parent === 0).map((c) => c.slug)) {
    for (let page = 1; page < 60; page++) {
      const d = await getJson(`${LAB}/document/documents?document_category=${slug}&limit=50&page=${page}&sort=acf&order=DESC&search=`);
      const posts = d.posts ?? [];
      if (!posts.length) break;
      let oldest: string | null = null;
      for (const p of posts) {
        const up = String(p.post_date).slice(0, 10);
        const acf: Acf = p.acf_data ?? {};
        const issue = iso(acf.date);
        for (const x of [up, issue]) if (x && (!oldest || x < oldest)) oldest = x;
        const [url, alt] = await labFile(acf, cache);
        out.push(item({ portal, section: names[slug] ?? slug, doc_type: dtype[slug] ?? "Other", title: clean(p.post_title), issue_date: issue, upload_date: up, url: url || `https://www.labour.gov.in/documents/${slug}`, alt_url: alt }));
      }
      if (page >= (d.total_pages ?? 1) || (oldest && oldest < frm && page > 1)) break;
    }
  }
  return uniq(out, (x) => `${x.title.toLowerCase().slice(0, 80)}|${x.upload_date}`); // What's New repeats document items
}

// ------------------------------------------------------------ ICAI
async function icai(): Promise<RawItem[]> {
  const out: RawItem[] = [];
  for (const [slug, sec] of [["announcements", "Announcements"], ["notifications", "Notifications"], ["board-of-studies-announcements", "BoS Announcements"]]) {
    const s = await getText(`https://www.icai.org/category/${slug}`);
    for (const [, href, body] of s.matchAll(/<li class='list-group-item'>\s*<a href ?=\s*'([^']+)'[^>]*>(.*?)<\/a>/gs)) {
      const t = clean(body);
      const m = t.match(/-\s*\((\d{2}-\d{2}-\d{4})\)\s*$/);
      out.push(item({ portal: "ICAI", section: sec, doc_type: sec === "Notifications" ? "Notification" : "Announcement", title: m ? t.slice(0, m.index).trim() : t, upload_date: m ? iso(m[1]) : null, url: href.startsWith("http") ? href : "https://www.icai.org" + href }));
    }
  }
  return out;
}

// ------------------------------------------------------------ CBIC legacy site (cbic-gst.gov.in)
async function cbicLegacy(_frm: string, to: string): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const s = await getText("https://cbic-gst.gov.in/tickers.html");
  for (const [row] of s.matchAll(/<tr.*?<\/tr>/gs)) {
    const t = clean(row);
    if (t.length < 25) continue;
    const ds = allDates(t).filter((d) => d <= to).sort();
    const link = row.match(/href="([^"]+)"/);
    let url = link ? link[1] : "https://cbic-gst.gov.in/tickers.html";
    if (!url.startsWith("http")) url = "https://cbic-gst.gov.in/" + url.replace(/^\/+/, "");
    out.push(item({ portal: "CBIC (cbic-gst.gov.in)", section: "Tickers", doc_type: "Advisory", title: t.replace(/^[“”" ]+|[“”" ]+$/g, ""), issue_date: ds.at(-1) ?? null, date_basis: "text", url }));
  }
  return out;
}

// ------------------------------------------------------------ PT Karnataka
async function ptax(): Promise<RawItem[]> {
  const t = clean(await getText("https://ptax.karnataka.gov.in/"));
  const line = t.match(/Commercial Taxes Department\s+(.*?)\s+Home\s/)?.[1] ?? "";
  return line ? [item({ portal: "Professional Tax – Karnataka", section: "Homepage ticker", doc_type: "Notice", title: line, date_basis: "text", url: "https://ptax.karnataka.gov.in/" })] : [];
}

// ------------------------------------------------------------ GST Council
const GSTC = "https://www.gstcouncil.gov.in";

/** Posting date for files on sites that show no date: the server's Last-Modified header, as an IST day. */
async function lastModified(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "HEAD", headers: UA, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const lm = r.headers.get("last-modified");
    return lm ? new Date(new Date(lm).getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function gstcouncil(frm: string, to: string): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const portal = "GST Council";
  // What's New and Newsletter: no date column; upload month is in the file path, exact day from Last-Modified
  for (const [path, sec, dtype] of [["/what-s-new", "What's New", "Notice"], ["/gst-council-newsletter", "Newsletter", "Publication"]]) {
    for (let page = 0; page < 10; page++) {
      const s = await getText(GSTC + path + (page ? `?page=${page}` : ""));
      const rows = [...s.matchAll(/<tr.*?<\/tr>/gs)].map((m) => m[0]).slice(1);
      if (!rows.length || s.includes("No Data Found")) break;
      let stop = false;
      for (const row of rows) {
        const link = row.match(/href="([^"]+)"/);
        if (!link) continue;
        const url = link[1].startsWith("http") ? link[1] : GSTC + link[1];
        const title = clean(row).replace(/\(Format:.*?\)/g, "").trim().replace(/^\d+\s+/, "");
        const m = url.match(/\/files\/(\d{4})-(\d{2})\//);
        const month = m ? `${m[1]}-${m[2]}` : null;
        if (month && month < frm.slice(0, 7)) { stop = true; continue; }
        const up = !month || month <= to.slice(0, 7) ? await lastModified(url) : null;
        out.push(item({ portal, section: sec, doc_type: dtype, title, upload_date: up, date_basis: "file-server", url }));
      }
      if (stop) break;
    }
  }
  // Circulars/Advisory and Meetings: dated tables
  for (const [row] of [...(await getText(GSTC + "/en/circularsadvisory")).matchAll(/<tr.*?<\/tr>/gs)].slice(1)) {
    const t = clean(row);
    const link = row.match(/href="([^"]+)"/);
    out.push(item({ portal, section: "Circulars/Advisory", doc_type: "Advisory", title: t.replace(/\s*View.*$/, ""), issue_date: iso(t), date_basis: "issue", url: link ? link[1] : GSTC + "/en/circularsadvisory" }));
  }
  for (const [row] of [...(await getText(GSTC + "/en/gst-council-meeting")).matchAll(/<tr.*?<\/tr>/gs)].slice(1)) {
    const t = clean(row);
    const links = [...row.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const name = t.match(/(\d+\w*\s+GST Council Meeting)/)?.[1] ?? t.slice(0, 60);
    const url = links[0] ? (links[0].startsWith("/") ? GSTC + links[0] : links[0]) : GSTC + "/en/gst-council-meeting";
    out.push(item({ portal, section: "GST Council Meetings", doc_type: "Meeting", title: name + " – agenda & minutes", issue_date: iso(t), date_basis: "issue", url }));
  }
  return out;
}

// ------------------------------------------------------------ document text
/** Start of a document's text (PDF or HTML page); a bracketed marker when it can't be read. */
export async function docText(url: string, maxc = 1800): Promise<string> {
  try {
    const prid = url.match(/pib\.gov\.in\/.*PRID=(\d+)/)?.[1];
    if (prid) { // PIB detail pages are JS-rendered; PressReleasePage.aspx is server-rendered
      const t = clean((await getText(`https://pib.gov.in/PressReleasePage.aspx?PRID=${prid}`)).replace(/<script.*?<\/script>|<style.*?<\/style>/gs, " "));
      const i = t.indexOf("Ministry of");
      return i >= 0 ? t.slice(i, i + maxc) : t.slice(0, maxc);
    }
    const r = await get(url);
    const buf = new Uint8Array(await r.arrayBuffer());
    if ((r.headers.get("content-type") || "").includes("pdf") || new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-") return pdfTextFromBytes(buf, maxc);
    const html = new TextDecoder().decode(buf).replace(/<(script|style|nav|header|footer)\b.*?<\/\1>/gis, " ");
    const body = html.match(/<(main|article)\b.*?<\/\1>/is)?.[0] ?? html; // ponytail: regex, not a DOM — good enough for plain portal pages
    return clean(body).slice(0, maxc);
  } catch (e) {
    return `[unreadable: ${String((e as Error).message).slice(0, 80)}]`;
  }
}

export async function pdfTextFromBytes(buf: Uint8Array, maxc = 1800): Promise<string> {
  try {
    const t = (await extractPdfText(buf, 3)).replace(/\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, maxc) : "[scanned PDF - no text layer]";
  } catch (e) {
    return `[unreadable: ${String((e as Error).message).slice(0, 80)}]`;
  }
}

function uniq<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

// Keyed by the portal name each source reports under (for the status line).
const SOURCES: [string, (frm: string, to: string) => Promise<RawItem[]>][] = [
  ["GST Council", gstcouncil],
  ["Income Tax e-filing portal", efiling],
  ["Ministry of Labour & Employment", labour],
  ["ICAI", icai],
  ["CBIC (cbic-gst.gov.in)", cbicLegacy],
  ["Professional Tax – Karnataka", ptax],
];

export type SourceResult = { portal: string; ok: boolean; error: string | null; fetched: number; undated: number; items: RawItem[] };

/** Run every server-side source for [frm, to]; in-range items get the start of their document text. */
export async function collectCloud(frm: string, to: string): Promise<SourceResult[]> {
  return Promise.all(
    SOURCES.map(async ([portal, fn]) => {
      try {
        const got = await fn(frm, to);
        const items = got.filter((x) => { const d = effDate(x); return !!d && d >= frm && d <= to; });
        for (const it of items) {
          const listing = !it.url || /\/whats-new$|tickers\.html$|latest-news$|\/documents\/[a-z-]+$/.test(it.url);
          const src = listing ? it.alt_url : it.url;
          if (src) it.text = await docText(src);
        }
        return { portal, ok: true, error: null, fetched: got.length, undated: got.filter((x) => !effDate(x)).length, items };
      } catch (e) {
        return { portal, ok: false, error: String((e as Error).message).slice(0, 200), fetched: 0, undated: 0, items: [] };
      }
    }),
  );
}

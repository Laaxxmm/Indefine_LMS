// Statutory digest store: save collected items, summarise them with Gemini, read a range.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { callGemini } from "@/lib/gemini";
import { effDate, STANDING_NOTES, type RawItem } from "./portals";

const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
const hasText = (t: string | null | undefined) => !!t && !t.startsWith("[");

/** Caveats the skill requires (⚑), derived from the item itself. */
function notesFor(x: RawItem): string | null {
  const n: string[] = [];
  if (!hasText(x.text)) n.push("Summary from the title only.");
  if (x.date_basis === "file-server") n.push("Posting date taken from the file server.");
  if (x.issue_date && x.upload_date && Date.parse(x.upload_date) - Date.parse(x.issue_date) > 45 * 86_400_000) n.push(`Re-posted: document dated ${fmt(x.issue_date)}.`);
  return n.length ? n.join(" ") : null;
}

export type PortalRun = { portal: string; ok: boolean; error: string | null; fetched: number; undated?: number; items: RawItem[] };

/** Upsert collected items. Existing summaries are kept. */
export async function saveItems(items: RawItem[]) {
  for (const x of items) {
    const postedOn = effDate(x);
    if (!postedOn || !x.title) continue;
    const url = x.url || "";
    const key = `${x.portal}|${url}|${x.title.slice(0, 60)}`;
    // A re-collection may come without the document (read failed this time): keep the stored text.
    const text = hasText(x.text) ? x.text : ((await prisma.statutoryPost.findUnique({ where: { key }, select: { text: true } }))?.text ?? x.text);
    const data = {
      section: x.section, docType: x.doc_type || "Other", title: x.title, issueDate: x.issue_date, uploadDate: x.upload_date,
      postedOn, dateBasis: x.date_basis || "upload", url, altUrl: x.alt_url, note: notesFor({ ...x, text }), text,
    };
    await prisma.statutoryPost.upsert({ where: { key }, create: { key, portal: x.portal, ...data }, update: data });
  }
}

/** Record a portal's status line for this collection. */
export async function saveStatus(run: Omit<PortalRun, "items"> & { inRange: number }, via: "server" | "extension") {
  const standing = STANDING_NOTES[run.portal];
  const status = !run.ok ? "failed" : standing?.status ?? (run.inRange ? "ok" : "no posts");
  const note = !run.ok
    ? run.error || "error"
    : [standing?.note, run.undated ? `${run.undated} undated item(s) skipped.` : ""].filter(Boolean).join(" ");
  await prisma.statutorySource.upsert({
    where: { portal: run.portal },
    create: { portal: run.portal, status, note, fetched: run.fetched, inRange: run.inRange, via, checkedAt: new Date() },
    update: { status, note, fetched: run.fetched, inRange: run.inRange, via, checkedAt: new Date() },
  });
}

// ------------------------------------------------------------ summaries (skill step 4)
const RULES = `You summarise posts from Indian statutory portals (CBDT, GST, MCA, Labour, EPFO, ESIC, ICAI, PT Karnataka) for a Chartered Accountancy firm.

Return JSON:
- summary: 2–3 plain sentences written from the document: what it does, who is affected, key dates/amounts/deadlines. State only what the document or title says. No speculation, no advice beyond who is affected. If only the title is available, summarise the title and do not invent content.
- area: "<Law> – <topic>", e.g. "Income Tax – TDS", "GST – returns", "EPF – wage ceiling / payroll", "Company law – late filing relief", "Department administration – recruitment".
- tag: one of
  - "Action": changes a filing, form, rate, threshold, due date, procedure or registration that a business or CA must act on, or opens a deadline-bound scheme/window (e.g. disclosure scheme, empanelment form, return utility release).
  - "Info": other business- or practitioner-relevant posts — statistics, entity-specific approvals/exemptions, consultations, new offices/jurisdictions, re-posted old documents.
  - "Internal": staff orders, transfers, promotions, recruitment, departmental exams, procurement/rate contracts, hospital stores/news, official-language notices, events. ESIC branches DPC Cell, E-I/E-II/E-VI, Med, MSU, RC Cell, राजभाषा and individual hospitals are Internal unless the subject is employer-facing; Revenue, Benefit, P&D and ICT are usually Info/Action.`;

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" }, area: { type: "string" }, tag: { type: "string", enum: ["Action", "Info", "Internal"] } },
  required: ["summary", "area", "tag"],
};
const resultZ = z.object({ summary: z.string().min(1), area: z.string(), tag: z.enum(["Action", "Info", "Internal"]) });

type PostRow = { id: string; portal: string; section: string | null; docType: string; title: string; issueDate: string | null; uploadDate: string | null; text: string | null };

async function summariseOne(p: PostRow) {
  const prompt = `${RULES}

POST
Portal: ${p.portal}
Section: ${p.section ?? "-"}
Type: ${p.docType}
Title: ${p.title}
Posted: ${p.uploadDate ?? "-"} · Document dated: ${p.issueDate ?? "-"}
Document text (start): ${hasText(p.text) ? p.text : "(not available — summarise from the title only)"}`;
  try {
    const r = resultZ.parse(JSON.parse(await callGemini(prompt, SCHEMA)));
    await prisma.statutoryPost.update({ where: { id: p.id }, data: { ...r, summarizedAt: new Date(), summaryError: null } });
  } catch (e) {
    await prisma.statutoryPost.update({ where: { id: p.id }, data: { summaryError: String((e as Error).message).slice(0, 300) } });
  }
}

let running: Promise<number> | null = null;

/** Summarise unsummarised posts until none are left or `budgetMs` runs out. One run at a time per process.
 *  Posts whose last attempt failed are retried (Gemini overloads are temporary), but only once per run. */
export function summarisePending(budgetMs = 240_000): Promise<number> {
  running ??= (async () => {
    const stopAt = Date.now() + budgetMs;
    const tried: string[] = [];
    try {
      while (Date.now() < stopAt) {
        const batch = await prisma.statutoryPost.findMany({
          where: { summarizedAt: null, id: { notIn: tried } },
          orderBy: { createdAt: "asc" },
          take: 4,
          select: { id: true, portal: true, section: true, docType: true, title: true, issueDate: true, uploadDate: true, text: true },
        });
        if (!batch.length) break;
        tried.push(...batch.map((p) => p.id));
        await Promise.all(batch.map(summariseOne));
      }
      return tried.length;
    } finally {
      running = null;
    }
  })();
  return running;
}

// ------------------------------------------------------------ read
export async function postsInRange(from: string, to: string) {
  const [posts, sources] = await Promise.all([
    prisma.statutoryPost.findMany({
      where: { postedOn: { gte: from, lte: to } },
      orderBy: { postedOn: "desc" },
      select: { id: true, portal: true, docType: true, title: true, issueDate: true, uploadDate: true, postedOn: true, url: true, altUrl: true, area: true, tag: true, summary: true, note: true, summaryError: true },
    }),
    prisma.statutorySource.findMany(),
  ]);
  return { posts, sources };
}
export type DigestPost = Awaited<ReturnType<typeof postsInRange>>["posts"][number];
export type DigestSource = Awaited<ReturnType<typeof postsInRange>>["sources"][number];

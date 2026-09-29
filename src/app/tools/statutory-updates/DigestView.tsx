"use client";

import { useState } from "react";
import type { DigestPost, DigestSource } from "@/lib/statutory/digest";
import { ALL_PORTALS, EXTENSION_PORTALS, TABS, TAG_LABEL, TAG_RANK, type Tag } from "@/lib/statutory/portals";

type Source = Omit<DigestSource, "checkedAt"> & { checkedAt: string };

const STALE_MS = 36 * 3600_000;
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const STATUS_CLS: Record<string, string> = { ok: "text-emerald-700", "no posts": "text-emerald-700", partial: "text-amber-700", failed: "text-rose-700", stale: "text-amber-700" };
const TAG_CLS: Record<string, string> = { Action: "bg-rose-50 text-rose-700", Info: "bg-sky-50 text-sky-800", Internal: "bg-muted text-ink-mute" };

const order = (xs: DigestPost[]) =>
  [...xs].sort((a, b) => (TAG_RANK[a.tag ?? "Info"] ?? 1) - (TAG_RANK[b.tag ?? "Info"] ?? 1) || b.postedOn.localeCompare(a.postedOn));

function Card({ x, showPortal }: { x: DigestPost; showPortal: boolean }) {
  const tag = (x.tag ?? "Info") as Tag;
  return (
    <div className={`border-t border-border ${tag === "Internal" ? "py-2.5" : "py-3.5"}`}>
      <a href={x.url || undefined} target="_blank" rel="noopener noreferrer" className={`font-semibold text-ink hover:underline ${tag === "Internal" ? "text-[13px]" : ""}`}>
        {x.title}
      </a>
      <div className="text-xs text-ink-mute mt-0.5">
        {showPortal && <>{x.portal} · </>}
        {x.docType} · Posted {fmt(x.uploadDate ?? x.postedOn)}
        {x.issueDate && x.issueDate !== x.uploadDate && <> · Document dated {fmt(x.issueDate)}</>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {x.tag && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TAG_CLS[tag]}`}>{TAG_LABEL[tag]}</span>}
        {x.area && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-900">{x.area}</span>}
      </div>
      <p className={`mt-1.5 text-ink-soft ${tag === "Internal" ? "text-[13px]" : "text-sm"}`}>
        {x.summary ?? (x.summaryError ? <span className="text-rose-700">Summary failed: {x.summaryError}</span> : <span className="text-ink-faint">Summary pending…</span>)}
      </p>
      {x.note && <p className="text-xs text-amber-800 mt-1">⚑ {x.note}</p>}
      <div className="text-xs mt-1 space-x-2">
        {x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">Source ↗</a>}
        {x.altUrl && <a href={x.altUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">Full text ↗</a>}
      </div>
    </div>
  );
}

function StatusLine({ portal, source, count, now }: { portal: string; source?: Source; count: number; now: number }) {
  let status = source?.status ?? "failed";
  let note = source?.note ?? (EXTENSION_PORTALS.includes(portal) ? "Not yet reported by the office-PC extension." : "Not collected yet.");
  if (source && now - Date.parse(source.checkedAt) > STALE_MS) {
    status = "stale";
    note = `Last checked ${new Date(source.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}${source.via === "extension" ? " — is the office-PC extension running?" : ""}`;
  }
  return (
    <div className="text-xs text-ink-mute py-1.5 border-b border-dashed border-border">
      <b className="text-ink-soft">{portal}</b> <span className={`font-semibold ${STATUS_CLS[status] ?? ""}`}>{status.toUpperCase()}</span> · {count} post{count === 1 ? "" : "s"}
      {note && <> · {note}</>}
    </div>
  );
}

function Panel({ posts, portals, sources, now }: { posts: DigestPost[]; portals: string[]; sources: Map<string, Source>; now: number }) {
  const multi = portals.length > 1;
  const main = order(posts.filter((x) => x.tag !== "Internal"));
  const internal = order(posts.filter((x) => x.tag === "Internal"));
  return (
    <>
      {portals.map((p) => <StatusLine key={p} portal={p} source={sources.get(p)} count={posts.filter((x) => x.portal === p).length} now={now} />)}
      {main.map((x) => <Card key={x.id} x={x} showPortal={multi} />)}
      {internal.length > 0 && (
        <details className="mt-2.5 pt-2 border-t border-border">
          <summary className="cursor-pointer text-ink-mute font-semibold text-sm">Internal / admin posts ({internal.length})</summary>
          {internal.map((x) => <Card key={x.id} x={x} showPortal={multi} />)}
        </details>
      )}
      {!posts.length && <p className="text-ink-mute text-sm py-3">No posts in this range.</p>}
    </>
  );
}

export function DigestView({ range, posts, sources, now }: { range: string; posts: DigestPost[]; sources: Source[]; now: number }) {
  const srcMap = new Map(sources.map((s) => [s.portal, s]));
  const acts = posts.filter((x) => x.tag === "Action");
  const nInternal = posts.filter((x) => x.tag === "Internal").length;
  const other = [...new Set(posts.map((x) => x.portal))].filter((p) => !ALL_PORTALS.includes(p));
  const tabs = [
    ...(acts.length ? [{ id: "action", name: "Needs action", portals: [] as string[], posts: acts, act: true }] : []),
    ...TABS.map((t) => ({ id: t.name, name: t.name, portals: t.portals, posts: posts.filter((x) => t.portals.includes(x.portal)), act: false })),
    ...(other.length ? [{ id: "other", name: "Other", portals: other, posts: posts.filter((x) => other.includes(x.portal)), act: false }] : []),
  ];
  const [active, setActive] = useState(tabs[0].id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="bg-brand-800 text-white rounded-[16px] px-5 py-4">
        <div className="text-xs opacity-80">Indian statutory updates</div>
        <div className="font-display font-bold text-xl mt-0.5">{range}</div>
        <div className="text-sm mt-1">
          {posts.length} posts · <b>{acts.length} need action</b> · {posts.length - acts.length - nInternal} for information · {nInternal} internal/admin
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3.5" role="tablist">
        {tabs.map((t) => {
          const on = t.id === tab.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className={`px-3 py-1.5 rounded-full border text-sm transition ${on ? "bg-brand-800 border-brand-800 text-white" : `bg-card border-border ${t.posts.length ? "text-ink" : "text-ink-faint"}`}`}
            >
              {t.name}
              <span className={`inline-block min-w-[22px] ml-1.5 px-1.5 rounded-full text-center font-semibold ${on ? "bg-white text-brand-800" : t.act ? "bg-rose-50 text-rose-700" : "bg-muted"}`}>
                {t.posts.length}
              </span>
            </button>
          );
        })}
      </div>

      <section className="bg-card border border-border rounded-[16px] px-5 py-3.5 mt-3" role="tabpanel">
        {tab.id === "action" ? order(tab.posts).map((x) => <Card key={x.id} x={x} showPortal />) : <Panel posts={tab.posts} portals={tab.portals} sources={srcMap} now={now} />}
      </section>

      <p className="text-[11px] text-ink-faint mt-3">
        The range applies to the date each portal posted the item; the document&apos;s own date is shown when different. Summaries are written from the
        documents by AI — open the source before acting. ⚑ marks title-only summaries or other caveats.
      </p>
    </div>
  );
}

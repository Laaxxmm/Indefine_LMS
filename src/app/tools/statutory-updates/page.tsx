import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { postsInRange } from "@/lib/statutory/digest";
import { istDay } from "@/lib/statutory/portals";
import { DigestView } from "./DigestView";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function presets() {
  const today = istDay(0);
  const monthStart = today.slice(0, 8) + "01";
  const prevMonthEnd = new Date(Date.parse(monthStart) - 86_400_000).toISOString().slice(0, 10);
  return [
    { label: "Yesterday", from: istDay(-1), to: istDay(-1) },
    { label: "Last 7 days", from: istDay(-6), to: today },
    { label: "Last 30 days", from: istDay(-29), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: prevMonthEnd.slice(0, 8) + "01", to: prevMonthEnd },
  ];
}

export default async function StatutoryUpdatesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseOfficeTools(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const from = sp.from && DAY.test(sp.from) ? sp.from : istDay(-6);
  const to = sp.to && DAY.test(sp.to) && sp.to >= from ? sp.to : istDay(0);
  const { posts, sources } = await postsInRange(from, to);

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Tools · Compliance</p>
        <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Statutory updates</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Everything the Income Tax, GST, MCA, Labour, EPFO, ESIC, PT Karnataka and ICAI portals posted, summarised from the documents. Collected daily.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-5">
        {presets().map((p) => {
          const on = p.from === from && p.to === to;
          return (
            <Link
              key={p.label}
              href={`?from=${p.from}&to=${p.to}`}
              className={`px-3.5 py-2 rounded-full text-sm font-semibold border transition ${on ? "bg-brand-500 border-brand-500 text-white" : "bg-card border-border text-ink-soft hover:bg-muted"}`}
            >
              {p.label}
            </Link>
          );
        })}
        <form className="flex flex-wrap items-end gap-2 ml-auto">
          <label className="text-xs text-ink-mute">
            From
            <input type="date" name="from" defaultValue={from} className="block mt-0.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-ink" />
          </label>
          <label className="text-xs text-ink-mute">
            To
            <input type="date" name="to" defaultValue={to} className="block mt-0.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-ink" />
          </label>
          <button className="px-4 py-2 rounded-full bg-ink text-white text-sm font-semibold">Show</button>
        </form>
      </div>

      <DigestView
        range={from === to ? fmt(from) : `${fmt(from)} to ${fmt(to)}`}
        posts={posts}
        sources={sources.map((s) => ({ ...s, checkedAt: s.checkedAt.toISOString() }))}
        now={Date.now()}
      />
    </div>
  );
}

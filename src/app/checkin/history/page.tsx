import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { weekLabel } from "@/lib/checkins";
import {
  ArrowLeft,
  Lightbulb,
  AlertCircle,
  Compass,
  MessageSquareQuote,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CheckinHistory() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;

  const checkins = await prisma.weeklyCheckin.findMany({
    where: { userId },
    orderBy: { weekStart: "desc" },
    take: 12,
  });

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <Link
          href="/checkin"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <ArrowLeft className="w-4 h-4" />
          This week
        </Link>
      </div>

      <p className="text-xs uppercase tracking-wider font-semibold text-ink-faint mb-1">
        Trajectory · Reflections
      </p>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-2">
        Your weekly check-ins
      </h1>
      <p className="text-ink-mute mb-8 text-sm">
        The last 12 weeks. A short story of your year as you write it.
      </p>

      {checkins.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
          <p className="text-ink-mute">No check-ins yet — the first one writes itself.</p>
          <Link
            href="/checkin"
            className="inline-block mt-3 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition"
          >
            Start this week&apos;s check-in
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {checkins.map((c) => (
            <article
              key={c.id}
              className="rounded-2xl bg-white border border-border shadow-soft p-5"
            >
              <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint mb-3">
                {weekLabel(c.weekStart)}
              </p>
              <div className="space-y-3">
                {c.whatWorked && (
                  <Row icon={Lightbulb} tint="emerald" label="What worked" text={c.whatWorked} />
                )}
                {c.whatBlocked && (
                  <Row icon={AlertCircle} tint="rose" label="Blocked by" text={c.whatBlocked} />
                )}
                {c.nextFocus && (
                  <Row icon={Compass} tint="violet" label="Next focus" text={c.nextFocus} />
                )}
                {c.managerReply && (
                  <Row
                    icon={MessageSquareQuote}
                    tint="brand"
                    label="Manager's reply"
                    text={c.managerReply}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function Row({
  icon: Icon,
  tint,
  label,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "emerald" | "rose" | "violet" | "brand";
  label: string;
  text: string;
}) {
  const tints = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
    brand: "bg-brand-50 text-brand-600",
  };
  return (
    <div className="flex items-start gap-3">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tints[tint]}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
          {label}
        </p>
        <p className="text-sm text-ink-soft mt-0.5">{text}</p>
      </div>
    </div>
  );
}

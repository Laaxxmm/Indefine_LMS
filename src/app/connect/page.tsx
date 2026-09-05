import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ELEVATED_SCOPES, LEAD_SCOPES, scopesCover } from "@/lib/graph-scopes";
import { isWorkLead } from "@/lib/work/core";
import { istLabel } from "@/lib/ist";
import { LogoMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

// One-time "Connect Microsoft 365" for people who act on Graph as themselves:
// live-session organizers (calendar, meetings, recordings, transcripts) and the
// work-tracker lead (Teams chat). Everyone else keeps the identity-only sign-in.
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const sp = await searchParams;
  const lead = isWorkLead(session.user.email);
  const wanted = lead ? LEAD_SCOPES : ELEVATED_SCOPES;
  const account = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "microsoft-entra-id" },
    select: { refresh_token: true, scope: true, elevatedAt: true },
  });
  const connected = !!account?.refresh_token && scopesCover(account.scope, wanted);
  const graphScopes = wanted.split(" ").filter((s) => !["openid", "profile", "email", "offline_access"].includes(s));

  async function connect() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/connect?done=1" }, { scope: wanted, prompt: "consent" });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-[520px] bg-card border border-border rounded-[26px] p-10 shadow-lift">
        <LogoMark size={44} />
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase mt-5">Microsoft 365</p>
        <h1 className="font-display font-extrabold text-[28px] tracking-[-0.02em] mt-1">Connect your account</h1>
        <p className="text-ink-mute text-[14.5px] mt-2">
          Needed only if you organise live sessions{lead ? " or send the work-tracker nudges" : ""}. It lets the LMS
          create Teams meetings on your calendar and read your recordings and transcripts
          {lead ? ", and post to the Tech Work chat" : ""}. Ordinary sign-in stays identity-only.
        </p>

        <div className={`mt-6 rounded-xl border px-4 py-3 text-[13.5px] ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-muted/40 text-ink-mute"}`}>
          {sp.done && connected && <span className="font-bold">Connected. </span>}
          {connected
            ? `Microsoft 365 is connected${account?.elevatedAt ? ` since ${istLabel(account.elevatedAt, { day: "numeric", month: "short", year: "numeric" })}` : ""}. Reconnect only if a permission was added.`
            : "Not connected yet."}
        </div>

        <details className="mt-4 text-[12.5px] text-ink-mute">
          <summary className="cursor-pointer font-semibold">Permissions requested</summary>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {graphScopes.map((s) => <li key={s}><code className="text-[11.5px] bg-muted px-1 py-0.5 rounded">{s}</code></li>)}
          </ul>
        </details>

        <form action={connect} className="mt-6 flex items-center gap-3 flex-wrap">
          <button type="submit" className="px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition">
            {connected ? "Reconnect" : "Connect Microsoft 365"}
          </button>
          <Link href="/dashboard" className="px-4 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink">Back to dashboard</Link>
        </form>
      </div>
    </main>
  );
}

import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sparkles, Trophy, Flame, GraduationCap } from "lucide-react";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-brand-300/40 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent-violet/30 rounded-full blur-3xl pointer-events-none" />

      <div className="relative grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center max-w-5xl w-full">
        {/* Hero pitch */}
        <div className="animate-slide-up">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-border text-xs text-ink-soft font-medium shadow-soft mb-6">
            <Sparkles className="w-3.5 h-3.5 text-accent-gold" />
            Internal learning portal
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold leading-[1.05] tracking-tight">
            Learn it.
            <br />
            <span className="text-gradient">Master it.</span>
            <br />
            Earn it.
          </h1>
          <p className="text-ink-mute mt-6 text-lg max-w-md leading-relaxed">
            Watch your training videos, ace the quizzes, build streaks and stack
            KRA points — all in one place.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
            <Pill icon={GraduationCap} label="Modules" tint="brand" />
            <Pill icon={Flame} label="Streaks" tint="rose" />
            <Pill icon={Trophy} label="Leaderboard" tint="gold" />
          </div>
        </div>

        {/* Sign-in card */}
        <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="rounded-3xl bg-white border border-border p-8 shadow-lift">
            <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
              <GraduationCap className="w-6 h-6" />
            </div>
            <h2 className="font-display text-2xl font-bold mb-2">Welcome back</h2>
            <p className="text-ink-mute text-sm mb-8">
              Sign in with your Microsoft 365 account to continue.
            </p>

            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-brand-500 to-accent-violet hover:opacity-95 transition rounded-xl py-3.5 font-semibold flex items-center justify-center gap-3 shadow-pop text-white"
              >
                <MicrosoftLogo />
                Sign in with Microsoft
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-xs text-ink-faint leading-relaxed">
                Single sign-on via your Indefine M365 account. New employees are
                auto-enrolled the first time they sign in.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Pill({
  icon: Icon,
  label,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tint: "brand" | "gold" | "rose";
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600 border-brand-100",
    gold: "bg-amber-50 text-amber-600 border-amber-100",
    rose: "bg-rose-50 text-rose-600 border-rose-100",
  };
  return (
    <div
      className={`px-3 py-2.5 rounded-xl border ${tints[tint]} flex flex-col items-center gap-1.5`}
    >
      <Icon className="w-4 h-4" />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

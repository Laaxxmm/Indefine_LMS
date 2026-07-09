import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/Logo";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main
      className="min-h-screen grid lg:grid-cols-[1.1fr_0.9fr]"
      style={{
        background: "radial-gradient(90% 80% at 12% 30%, #EFEBFF, #F5F5FB 60%)",
      }}
    >
      {/* Left — pitch */}
      <div className="flex flex-col justify-center px-8 sm:px-14 lg:px-[70px] py-16 animate-fade-in">
        <div className="inline-flex self-start items-center gap-2 bg-white border border-border px-4 py-2 rounded-full font-extrabold text-[12.5px] text-brand-600 shadow-[0_4px_14px_-8px_rgba(20,19,43,0.3)]">
          <span className="text-accent-coral">✦</span> Internal learning portal
        </div>

        <h1 className="font-display font-black leading-[0.98] tracking-[-0.04em] text-[15vw] sm:text-6xl lg:text-[76px] mt-7">
          <span className="block text-ink">Learn it.</span>
          <span
            className="block"
            style={{
              background: "linear-gradient(90deg,#5B4BE6,#C0489E)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Master it.
          </span>
          <span className="block text-ink">Earn it.</span>
        </h1>

        <p className="text-[17px] text-ink-mute font-semibold max-w-[440px] mt-6">
          Watch your training videos, ace the quizzes, build streaks and stack KRA
          points — all in one place.
        </p>

        <div className="flex gap-3.5 mt-8">
          <FeatureChip emoji="🎓" label="Modules" bg="#EEEBFF" border="#DDD6FA" fg="#4B37D8" />
          <FeatureChip emoji="🔥" label="Streaks" bg="#FFEEE9" border="#FBD5CB" fg="#D9492B" />
          <FeatureChip emoji="🏆" label="Leaderboard" bg="#FFF6E0" border="#FBEBC4" fg="#D08512" />
        </div>
      </div>

      {/* Right — sign-in card */}
      <div className="flex items-center justify-center px-8 sm:px-14 lg:pr-[70px] lg:pl-5 pb-16 lg:py-16 animate-fade-in">
        <div className="w-full max-w-[440px] bg-card border border-border rounded-[26px] p-10 shadow-[0_30px_70px_-30px_rgba(20,19,43,0.4)]">
          <LogoMark size={52} />
          <h2 className="font-display font-extrabold text-[30px] tracking-[-0.02em] mt-5 mb-1.5 text-ink">
            Welcome back
          </h2>
          <p className="text-[14.5px] text-ink-mute font-semibold mb-6">
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
              className="w-full font-extrabold text-[15.5px] text-white rounded-[14px] py-4 flex items-center justify-center gap-3 transition hover:opacity-95"
              style={{
                background: "linear-gradient(135deg,#6D5BF0,#4B37D8)",
                boxShadow: "0 12px 26px -10px rgba(91,75,230,0.6)",
              }}
            >
              <MicrosoftLogo />
              Sign in with Microsoft
            </button>
          </form>

          <div className="border-t border-border mt-6 mb-4" />
          <p className="text-[12.5px] text-ink-faint font-semibold leading-relaxed">
            Single sign-on via your Indefine M365 account. New employees are
            auto-enrolled the first time they sign in.
          </p>
        </div>
      </div>
    </main>
  );
}

function FeatureChip({
  emoji,
  label,
  bg,
  border,
  fg,
}: {
  emoji: string;
  label: string;
  bg: string;
  border: string;
  fg: string;
}) {
  return (
    <div
      className="flex-1 max-w-[150px] text-center rounded-2xl py-[18px] px-3 border"
      style={{ background: bg, borderColor: border }}
    >
      <div className="text-[22px]">{emoji}</div>
      <div className="font-extrabold text-[13.5px] mt-1.5" style={{ color: fg }}>
        {label}
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="0" y="0" width="8" height="8" fill="#F25022" />
      <rect x="10" y="0" width="8" height="8" fill="#7FBA00" />
      <rect x="0" y="10" width="8" height="8" fill="#00A4EF" />
      <rect x="10" y="10" width="8" height="8" fill="#FFB900" />
    </svg>
  );
}

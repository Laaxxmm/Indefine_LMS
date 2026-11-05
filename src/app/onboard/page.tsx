import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canOnboard } from "@/lib/rbac/policy";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { OnboardingError, type RunView } from "@/lib/agents/onboarding/service";
import { OnboardPanel } from "./OnboardPanel";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ run?: string }> };

export default async function OnboardPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canOnboard(session.user)) redirect("/dashboard");

  const { run } = await searchParams;
  let initial: RunView | null = null;
  if (run && /^[\w-]{1,64}$/.test(run)) {
    try {
      initial = await onboardingService().get(run);
    } catch (e) {
      if (!(e instanceof OnboardingError)) throw e;
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-mute uppercase">Firm OS · Onboard</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">Onboard a client</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          Describe the client in one sentence. You will be asked only for what is missing, then shown exactly what will be created before anything is.
        </p>
      </div>
      <OnboardPanel initial={initial} />
    </div>
  );
}

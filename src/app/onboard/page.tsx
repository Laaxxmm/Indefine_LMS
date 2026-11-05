import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canOnboard } from "@/lib/rbac/policy";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { OnboardingError, type RunView } from "@/lib/agents/onboarding/service";
import { PageHeader } from "@/components/firm-os";
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
      <PageHeader
        eyebrow="Firm OS · Onboard"
        title="Onboard a client"
        lead="Describe the client in one sentence. You will be asked only for what is missing, then shown exactly what will be created before anything is."
      />
      <OnboardPanel initial={initial} />
    </div>
  );
}

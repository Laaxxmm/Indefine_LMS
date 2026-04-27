import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import WizardProgress from "../WizardProgress";
import AspirationForm from "./AspirationForm";
import { Compass } from "lucide-react";

export const dynamic = "force-dynamic";

async function saveAspiration(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const aspiration = String(formData.get("aspiration") || "").trim();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { aspiration: aspiration || null },
  });
  redirect("/wizard/quests");
}

export default async function AspirationStep() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { aspiration: true },
  });

  return (
    <div className="animate-slide-up">
      <WizardProgress active="aspiration" />
      <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-4">
        <Compass className="w-6 h-6" />
      </div>
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
        Where are you headed?
      </h1>
      <p className="text-ink-mute mb-6">
        In one or two sentences — where do you want to be 12 months from now?
        This helps us tailor your quests and learning suggestions.
      </p>
      <AspirationForm initial={user?.aspiration ?? ""} action={saveAspiration} />
    </div>
  );
}

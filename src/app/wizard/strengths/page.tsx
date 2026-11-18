import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import StrengthsPicker from "./StrengthsPicker";
import WizardProgress from "../WizardProgress";
import { STRENGTHS } from "@/lib/wizard";

export const dynamic = "force-dynamic";

async function saveStrengths(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const raw = String(formData.get("strengths") || "[]");
  let parsed: string[] = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  await prisma.user.update({
    where: { id: session.user.id },
    // Only known ids: anything else (objects, long strings) would land on manager pages.
    data: { strengths: (Array.isArray(parsed) ? parsed : []).filter((s) => STRENGTHS.some((x) => x.id === s)).slice(0, 5) },
  });
  revalidatePath("/wizard/aspiration");
  redirect("/wizard/aspiration");
}

export default async function StrengthsStep() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { strengths: true },
  });
  const initial = (user?.strengths as string[] | null) ?? [];

  return (
    <div className="animate-slide-up">
      <WizardProgress active="strengths" />
      <StrengthsPicker initial={initial} action={saveStrengths} />
    </div>
  );
}

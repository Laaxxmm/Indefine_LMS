import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Settings as SettingsIcon } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { isAdmin } from "@/lib/access";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
}

function clampInt(v: FormDataEntryValue | null, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function saveDefaults(formData: FormData) {
  "use server";
  await requireAdmin();
  const quizTimeLimitSec = clampInt(formData.get("timeLimitMin"), 1, 180, 10) * 60;
  const quizPassPercent = clampInt(formData.get("passPercent"), 1, 100, 70);
  const quizUnlockAtPercent = clampInt(formData.get("unlockAtPercent"), 0, 100, 90);

  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, quizTimeLimitSec, quizPassPercent, quizUnlockAtPercent },
    update: { quizTimeLimitSec, quizPassPercent, quizUnlockAtPercent },
  });
  revalidatePath("/admin/settings");
}

// Push the currently-saved defaults onto every existing quiz.
async function applyToAll() {
  "use server";
  await requireAdmin();
  const s = await getSettings();
  await prisma.quiz.updateMany({
    data: {
      timeLimitSec: s.quizTimeLimitSec,
      passPercent: s.quizPassPercent,
      unlockAtPercent: s.quizUnlockAtPercent,
    },
  });
  revalidatePath("/admin/settings");
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [settings, quizCount] = await Promise.all([getSettings(), prisma.quiz.count()]);

  return (
    <main className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-8 flex items-start gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1">
            Admin · Settings
          </p>
          <h1 className="font-display text-[30px] font-extrabold tracking-[-0.02em] leading-none">
            Settings
          </h1>
          <p className="text-ink-mute mt-2 text-sm max-w-2xl">
            Global defaults applied to <strong>newly</strong> generated quizzes. Any individual quiz can
            still be overridden on its video page.
          </p>
        </div>
      </div>

      <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-6">
        <h2 className="font-display text-lg font-bold mb-1">Microsoft 365 connection</h2>
        <p className="text-sm text-ink-mute mb-4">
          Sign-in asks for identity only. Anyone who organises live sessions, and the work-tracker
          lead, connects once to grant the calendar, meeting and drive permissions the LMS acts with
          on their behalf. Organizers who have not connected do not appear in the scheduling picker.
        </p>
        <Link href="/connect" className="inline-flex px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">
          Open /connect
        </Link>
      </section>

      <section className="rounded-2xl bg-white border border-border shadow-soft p-6">
        <h2 className="font-display text-lg font-bold mb-1">Default quiz settings</h2>
        <p className="text-sm text-ink-mute mb-5">
          New auto-generated quizzes use these values.
        </p>

        <form action={saveDefaults} className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field
              label="Time limit (min)"
              name="timeLimitMin"
              defaultValue={Math.round(settings.quizTimeLimitSec / 60)}
              min={1}
              max={180}
            />
            <Field
              label="Pass percent"
              name="passPercent"
              defaultValue={settings.quizPassPercent}
              min={1}
              max={100}
            />
            <Field
              label="Unlock at video % watched"
              name="unlockAtPercent"
              defaultValue={settings.quizUnlockAtPercent}
              min={0}
              max={100}
            />
          </div>
          <SubmitButton className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">
            Save defaults
          </SubmitButton>
        </form>

        <div className="mt-6 pt-6 border-t border-border">
          <h3 className="font-semibold text-sm">Apply to existing quizzes</h3>
          <p className="text-sm text-ink-mute mt-1 mb-3">
            Push the saved defaults above onto all {quizCount} existing quiz
            {quizCount === 1 ? "" : "zes"} at once. Overwrites timing / pass / unlock only —
            question content is untouched.
          </p>
          <form action={applyToAll}>
            <SubmitButton
              savedLabel="Applied"
              className="px-4 py-2 rounded-lg bg-white border border-border hover:bg-muted text-ink-soft text-sm font-semibold"
            >
              Apply to all {quizCount} quiz{quizCount === 1 ? "" : "zes"}
            </SubmitButton>
          </form>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
  min,
  max,
}: {
  label: string;
  name: string;
  defaultValue: number;
  min: number;
  max: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-ink-mute mb-1">{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
      />
    </label>
  );
}

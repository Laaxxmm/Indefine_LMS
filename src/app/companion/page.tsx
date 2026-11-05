import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { card } from "@/components/ui";
import { hasCompanionAccess } from "@/lib/companion/access";
import { companionDb } from "@/lib/companion/defaults";
import { COMPANION_MAX_ACTIVE_TOKENS, COMPANION_TOKEN_TTL_DAYS } from "@/lib/companion/config";
import { MSG } from "@/lib/companion/messages";
import { listPairings } from "@/lib/companion/tokens";
import { eyebrow, pageTitle, sectionTitle } from "@/app/agents/parts";
import { CompanionPanel } from "./CompanionPanel";

export const dynamic = "force-dynamic";

const SETUP_STEPS = [
  "Get the Firm OS Companion extension folder from your admin. In Chrome, open the Extensions page (chrome://extensions), turn on Developer mode and choose Load unpacked.",
  "Create a pairing token on this page and copy it.",
  "Open the companion's Options page (right-click its toolbar icon, then Options), paste the token and choose Save and test connection.",
  "Click the toolbar icon to open the side panel beside the page you are working on.",
];

// Pair the read-only Firm OS Companion side panel. People without companion access see why and
// who can turn it on; no pairing is read or created for them.
export default async function CompanionPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const db = companionDb();
  const allowed = await hasCompanionAccess(db, session.user);
  const pairings = allowed ? await listPairings(db, session.user.id, new Date()) : null;

  return (
    <div>
      <div className="mb-6">
        <p className={eyebrow}>Firm OS</p>
        <h1 className={pageTitle}>Companion</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
          The Companion is a Chrome side panel that keeps your current task&apos;s steps beside the page you are working on, one task at a time. It only reads your task list. It never reads, fills or submits any web page, and never files, signs, pays or sends anything.
        </p>
      </div>

      {pairings ? (
        <CompanionPanel pairings={pairings.active} inactiveCount={pairings.inactiveCount} maxActive={COMPANION_MAX_ACTIVE_TOKENS} ttlDays={COMPANION_TOKEN_TTL_DAYS} />
      ) : (
        <section aria-labelledby="no-access" className={`${card} max-w-[640px]`}>
          <h2 id="no-access" className={sectionTitle}>
            Not turned on for you
          </h2>
          <p className="text-[13.5px]">{MSG.noAccess}</p>
        </section>
      )}

      <section aria-labelledby="setup" className="mt-8 max-w-[640px]">
        <h2 id="setup" className={sectionTitle}>
          How to set it up
        </h2>
        <ol className={`${card} space-y-2 text-[13.5px]`}>
          {SETUP_STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="tabular-nums font-bold text-ink-mute w-5 shrink-0 text-right">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

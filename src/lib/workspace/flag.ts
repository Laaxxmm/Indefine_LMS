// The Firm OS master switch: FIRM_OS_ENABLED, default OFF (the spec's "Firm OS defaults off in
// production"). Server-side only — it reads the server's environment on each request; without a
// NEXT_PUBLIC_ prefix the value never reaches a browser bundle.
//
//   off  Firm OS is closed for everyone: the onboard, agents (with /focus and /workspace), coach,
//        comms and search modules, the companion, spot checks and the admin Firm OS pages (all but
//        Workspace settings, where the rollout is prepared). LMS pages show no Firm OS link or card
//        and make no Firm OS query — the workspace settings are not even read
//        (src/lib/workspace/settings.ts loadWorkspace). Firm OS pages send people to the dashboard,
//        which says Firm OS is not switched on; Firm OS APIs answer 404 with that sentence
//        (firmOsOffResponse, one line at the top of each handler).
//   on   the workspace module settings decide, person by person (/admin/firm-os/workspace). Pilot:
//        save role defaults without the Firm OS modules, turn the flag on, then switch the modules
//        on for the pilot people (docs/go-live.md §3).
type Env = Record<string, string | undefined>;

const ON = new Set(["1", "true", "on", "yes"]);

export function firmOsEnabled(env: Env = process.env): boolean {
  return ON.has((env.FIRM_OS_ENABLED ?? "").trim().toLowerCase());
}

/** What a person reads when Firm OS is switched off: what is wrong and what to do. */
export const FIRM_OS_OFF_MESSAGE = "Firm OS is not switched on for the firm yet. Everything else works as before; ask an admin if you expected to use it.";

/** The answer of a Firm OS API while the switch is off: `if (!firmOsEnabled()) return firmOsOffResponse();` */
export function firmOsOffResponse(): Response {
  return Response.json({ error: FIRM_OS_OFF_MESSAGE }, { status: 404 });
}

/**
 * A Firm OS cron while the switch is off: nothing to do, and a 200 so the scheduler does not report
 * a failure. `if (!firmOsEnabled()) return firmOsOffCronResponse();` after the CRON_SECRET check.
 */
export function firmOsOffCronResponse(): Response {
  return Response.json({ ok: true, skipped: FIRM_OS_OFF_MESSAGE });
}

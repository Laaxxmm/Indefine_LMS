// Coach feature flags. Default OFF (orchestrator NON-NEGOTIABLE 7).
type Env = Record<string, string | undefined>;

const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? "").trim());

/**
 * FIRM_OS_BREAK_NUDGE: collect LMS activity heartbeats and show break nudges (ADR-006). Off means no
 * heartbeat is stored and no ping is sent. Staff are told what is collected before it is turned on.
 */
export function isBreakNudgeEnabled(env: Env = process.env): boolean {
  return on(env.FIRM_OS_BREAK_NUDGE);
}

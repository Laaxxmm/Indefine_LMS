// Feature flags for the agent framework. Default OFF (orchestrator NON-NEGOTIABLE 7).
type Env = Record<string, string | undefined>;

const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? "").trim());

/** FIRM_OS_ECHO_AGENT: show the internal Echo test agent on /agents (staging / demos). */
export function isEchoAgentEnabled(env: Env = process.env): boolean {
  return on(env.FIRM_OS_ECHO_AGENT);
}

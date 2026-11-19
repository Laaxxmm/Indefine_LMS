// Task agents known to Firm OS, by route key (/agents/[agent]). Phase 5+ adds gst, roc, tax,
// books, audit here. Internal agents (echo) exist for framework tests and stay hidden unless
// FIRM_OS_ECHO_AGENT is on.
import type { AnyAgent } from "@/lib/agents/core/runner";
import { echoAgent } from "@/lib/agents/echo";
import { gstAgent } from "@/lib/agents/gst";
import { booksAgent } from "@/lib/agents/books";
import { auditAgent } from "@/lib/agents/audit";
import { rocAgent } from "@/lib/agents/roc";
import { taxAgent } from "@/lib/agents/tax";
import { isEchoAgentEnabled } from "./flags";

export const AGENTS: Readonly<Record<string, AnyAgent>> = Object.freeze({
  [echoAgent.key]: echoAgent,
  [gstAgent.key]: gstAgent,
  [booksAgent.key]: booksAgent,
  [auditAgent.key]: auditAgent,
  [rocAgent.key]: rocAgent,
  [taxAgent.key]: taxAgent,
});

export function getAgent(key: string, agents: Readonly<Record<string, AnyAgent>> = AGENTS): AnyAgent | undefined {
  return Object.prototype.hasOwnProperty.call(agents, key) ? agents[key] : undefined;
}

/**
 * The agent that prepares a job of this service, or null. A job marked `agentless` (a Turia task
 * no rule maps, ADR-003 amendment) never gets one: it is prepared by hand.
 */
export function agentForJob<A extends { service: string }>(job: { service: string; agentless?: boolean | null }, agents: readonly A[]): A | null {
  if (job.agentless) return null;
  return agents.find((a) => a.service === job.service) ?? null;
}

/** Agents a person may see and run in the UI right now. */
export function visibleAgents(env: Record<string, string | undefined> = process.env, agents: Readonly<Record<string, AnyAgent>> = AGENTS): AnyAgent[] {
  return Object.values(agents).filter((a) => !a.internal || isEchoAgentEnabled(env));
}

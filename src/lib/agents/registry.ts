// Task agents known to Firm OS, by route key (/agents/[agent]). Phase 5+ adds gst, roc, tax,
// books, audit here. Internal agents (echo) exist for framework tests and stay hidden unless
// FIRM_OS_ECHO_AGENT is on.
import type { AnyAgent } from "@/lib/agents/core/runner";
import { echoAgent } from "@/lib/agents/echo";
import { gstAgent } from "@/lib/agents/gst";
import { booksAgent } from "@/lib/agents/books";
import { auditAgent } from "@/lib/agents/audit";
import { isEchoAgentEnabled } from "./flags";

export const AGENTS: Readonly<Record<string, AnyAgent>> = Object.freeze({
  [echoAgent.key]: echoAgent,
  [gstAgent.key]: gstAgent,
  [booksAgent.key]: booksAgent,
  [auditAgent.key]: auditAgent,
});

export function getAgent(key: string, agents: Readonly<Record<string, AnyAgent>> = AGENTS): AnyAgent | undefined {
  return Object.prototype.hasOwnProperty.call(agents, key) ? agents[key] : undefined;
}

/** Agents a person may see and run in the UI right now. */
export function visibleAgents(env: Record<string, string | undefined> = process.env, agents: Readonly<Record<string, AnyAgent>> = AGENTS): AnyAgent[] {
  return Object.values(agents).filter((a) => !a.internal || isEchoAgentEnabled(env));
}

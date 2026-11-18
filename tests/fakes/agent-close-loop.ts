// The close-loop hook over the in-memory agent world (tests/fakes/agent-world.ts): the real
// afterTransition dispatcher with the production copyToFinal (agentServiceCopyToFinal → the agents
// service finalizeRun), the memory db as the close-loop db and a manual Turia bridge.
import { vi } from "vitest";
import type { TransitionHook } from "@/lib/agents/service";
import type { CloseLoopDb } from "@/lib/close-loop/db";
import { agentServiceCopyToFinal } from "@/lib/close-loop/defaults";
import { afterTransition, type CopyToFinal, type HookDeps, type HookOutcome } from "@/lib/close-loop/hooks";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import type { World } from "./agent-world";
import { FakeTuriaRepo } from "./fake-turia-repo";

export function worldHookDeps(w: World, copyToFinal?: CopyToFinal): HookDeps {
  return {
    db: w.db as unknown as CloseLoopDb,
    turia: new ManualBridge(new FakeTuriaRepo()),
    copyToFinal: copyToFinal ?? agentServiceCopyToFinal(async () => w.deps),
  };
}

/** A spy TransitionHook running the real afterTransition over the world; `outcomes` in call order. */
export function recordingHook(w: World, copyToFinal?: CopyToFinal) {
  const deps = worldHookDeps(w, copyToFinal);
  const outcomes: HookOutcome[] = [];
  const hook = vi.fn<TransitionHook>(async (t, user) => {
    const out = await afterTransition(t, user, deps);
    outcomes.push(out);
    return out;
  });
  return { hook, outcomes, deps };
}

// Jobs marked `agentless` (Turia tasks no rule maps, ADR-003 amendment) are work without an agent:
// Next task / My day offer "Open the job" (prepare by hand), /agents never lists them as runnable,
// and the runner refuses them before recording anything.
import { describe, expect, it } from "vitest";
import { echoAgent } from "@/lib/agents/echo";
import { gstAgent } from "@/lib/agents/gst";
import { runAgent } from "@/lib/agents/core/runner";
import { agentForJob } from "@/lib/agents/registry";
import { actionFor } from "@/lib/workspace/next-task";
import { echoWorld, rows } from "../../../tests/fakes/agent-world";

const user = { id: "u-priya", name: "Priya", email: "p@x.test", role: "EMPLOYEE", level: "EXECUTIVE", active: true } as never;
const job = { id: "j1", state: "ASSIGNED" as const, service: "GST" as const, assigneeId: "u-priya", reviewerId: "u-ravi" };

describe("agentless jobs", () => {
  it("get no agent, whatever their service", () => {
    expect(agentForJob({ service: "GST" }, [gstAgent])).toBe(gstAgent);
    expect(agentForJob({ service: "GST", agentless: true }, [gstAgent])).toBeNull();
    expect(agentForJob({ service: "TDS" }, [gstAgent])).toBeNull();
  });

  it("show in the person's queue as work to prepare by hand", () => {
    const now = new Date("2026-11-06T06:00:00Z");
    expect(actionFor(user, job, null, [gstAgent], now)).toMatchObject({ kind: "run-agent", agent: "gst" });
    expect(actionFor(user, { ...job, agentless: true }, null, [gstAgent], now)).toMatchObject({ kind: "prepare-by-hand", href: "/workspace/j1", agent: null });
  });

  it("are refused by the runner, with nothing recorded", async () => {
    const w = echoWorld();
    rows(w.db, "jobTask")[0].agentless = true;
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "WRONG_SERVICE", reason: expect.stringMatching(/prepare it by hand/) });
    expect(rows(w.db, "agentRun")).toHaveLength(0);
  });
});

// Production wiring: copyToFinal goes through the agents service finalize path; closeLoopDeps
// builds lazily (no Graph call until a file is checked).
import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { AgentServiceDeps } from "@/lib/agents/service";
import { agentServiceCopyToFinal, closeLoopDeps } from "./defaults";

const user = { id: "u-ravi" } as Session["user"];

function load(run: { id: string } | null) {
  const findFirst = vi.fn(async () => run);
  return { findFirst, load: async () => ({ db: { agentRun: { findFirst } } }) as unknown as AgentServiceDeps };
}

describe("agentServiceCopyToFinal", () => {
  it("finalises the job's latest run as the approver", async () => {
    const l = load({ id: "run-7" });
    const finalize = vi.fn(async () => ({ ok: true as const, data: { state: "APPROVED" as const, final: ["a_v1.xlsx", "b_v1.docx"] } }));
    expect(await agentServiceCopyToFinal(l.load, finalize)("job-1", user)).toEqual({ copied: 2 });
    expect(l.findFirst).toHaveBeenCalledWith({ where: { jobTaskId: "job-1" }, orderBy: { startedAt: "desc" }, select: { id: true } });
    expect(finalize).toHaveBeenCalledWith(user, "run-7", expect.anything());
  });

  it("no agent run, or a failed finalize, is an error the hook records", async () => {
    await expect(agentServiceCopyToFinal(load(null).load, vi.fn())("job-1", user)).rejects.toThrow(/no agent run/);
    const finalize = vi.fn(async () => ({ ok: false as const, status: 502 as const, error: "copying to Final failed" }));
    await expect(agentServiceCopyToFinal(load({ id: "r" }).load, finalize)("job-1", user)).rejects.toThrow(/copying to Final failed/);
  });
});

describe("closeLoopDeps", () => {
  it("wires Prisma, the Graph verifier, the active Turia bridge (manual by default) and the manual bridge", () => {
    const d = closeLoopDeps();
    expect(d.turia.mode).toBe("MANUAL");
    expect(typeof d.verifier.getItem).toBe("function");
    expect(typeof d.manual.confirm).toBe("function");
    expect(typeof d.copyToFinal).toBe("function");
    expect(d.now!()).toBeInstanceOf(Date);
  });
});

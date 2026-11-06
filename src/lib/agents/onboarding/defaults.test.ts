import { describe, expect, it, vi } from "vitest";

const prisma = {
  user: { findMany: vi.fn(async () => [{ id: "u-1", name: "Priya Sharma", email: "p@x" }]) },
  onboardingRun: { findUnique: vi.fn(async () => null) },
  turiaSync: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  firmClient: { update: vi.fn(async () => ({})) },
  auditEvent: { create: vi.fn(async () => ({})) },
  sopPack: { findMany: vi.fn(async () => []) },
};
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/router", () => ({ run: vi.fn() }));

const { onboardingService } = await import("./defaults");

describe("production wiring", () => {
  it("builds the service from env defaults (ManualBridge, confirm required) without touching the network", async () => {
    const svc = onboardingService({ viewer: null });
    expect(Object.keys(svc).sort()).toEqual(["answer", "create", "get", "plan", "resume", "start", "turiaConfirm"]);
    await expect(svc.get("missing")).rejects.toMatchObject({ code: "not-found" });
    await expect(svc.resume("missing", "u")).rejects.toMatchObject({ code: "not-found" });
  });
});

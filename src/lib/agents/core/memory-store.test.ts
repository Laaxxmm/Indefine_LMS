import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./memory-store";

describe("memory store", () => {
  it("create-only with version bumps, copy, read, verify", async () => {
    const s = createMemoryStore();
    const d = await s.complianceDrive("ACME01");
    const a = await s.putNew(d, "W", "A_v1.xlsx", Buffer.from("one"));
    const b = await s.putNew(d, "W", "A_v1.xlsx", Buffer.from("two"));
    expect([a.fileName, b.fileName]).toEqual(["A_v1.xlsx", "A_v2.xlsx"]);
    const c = await s.copyVersioned(d, "W", "A_v1.xlsx", "F");
    expect(c).toMatchObject({ fileName: "A_v1.xlsx", sha256: a.sha256, folder: "F" });
    expect(s.list("W")).toEqual(["A_v1.xlsx", "A_v2.xlsx"]);
    expect((await s.read(d, "F", "A_v1.xlsx"))?.toString()).toBe("one");
    expect(await s.read(d, "F", "nope")).toBeNull();
    expect(await s.verify(d, "F", "A_v1.xlsx", a.sha256.toUpperCase())).toBe(true);
    expect(await s.verify(d, "F", "nope", a.sha256)).toBe(false);
    await expect(s.copyVersioned(d, "W", "missing.xlsx", "F")).rejects.toThrow(/not there/);
  });
});

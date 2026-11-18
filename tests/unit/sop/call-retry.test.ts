// A Gemini call that runs away is abandoned after 15 s and asked again, up to 3 tries; any other
// error is not retried. callGemini (the mask gate) is faked; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGemini = vi.fn();
vi.mock("@/lib/gemini", () => ({ callGemini: (...a: unknown[]) => callGemini(...a) }));

const { callWithRetry } = await import("@/lib/sop/gemini");
const never = () => new Promise<string>(() => {});

beforeEach(() => {
  callGemini.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("callWithRetry", () => {
  it("returns the first answer when it comes in time", async () => {
    callGemini.mockResolvedValueOnce("{}");
    await expect(callWithRetry("p", {}, [])).resolves.toBe("{}");
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it("asks again after a call runs past 15 s, and passes the dictionary every time", async () => {
    const dictionary = [{ value: "Kestrel Widgets Pvt Ltd", kind: "NAME" as const }];
    callGemini.mockImplementationOnce(never).mockImplementationOnce(never).mockResolvedValueOnce("ok");
    const out = callWithRetry("p", {}, dictionary);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(out).resolves.toBe("ok");
    expect(callGemini).toHaveBeenCalledTimes(3);
    for (const call of callGemini.mock.calls) expect(call[2]).toMatchObject({ dictionary });
  });

  it("gives up after the third try, with a plain-English error", async () => {
    callGemini.mockImplementation(never);
    const out = callWithRetry("p", {}, []);
    const check = expect(out).rejects.toThrow("The AI took too long to answer");
    await vi.advanceTimersByTimeAsync(45_000);
    await check;
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it("a call that fails after it was abandoned raises no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      // First call fails only at callGemini's own 45 s abort, long after the retry answered.
      callGemini.mockImplementationOnce(() => new Promise<string>((_, reject) => setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })), 45_000))).mockResolvedValueOnce("ok");
      const out = callWithRetry("p", {}, []);
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(out).resolves.toBe("ok");
      await vi.advanceTimersByTimeAsync(30_000);
      vi.useRealTimers(); // let Node report any unhandled rejection before checking
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not retry other failures (for example the leak gate refusing to send)", async () => {
    callGemini.mockRejectedValueOnce(new Error("blocked"));
    await expect(callWithRetry("p", {}, [])).rejects.toThrow("blocked");
    expect(callGemini).toHaveBeenCalledTimes(1);
  });
});

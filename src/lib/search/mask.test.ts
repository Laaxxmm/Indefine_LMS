// Re-audit NEW-13 (LOW): maskText was quadratic — the e-mail pattern `[…]+@` rescanned a long run
// without "@" from every position (100 KB took ~12 s and blocked the event loop for everyone). The
// e-mail pass is now a linear "@" scan, every other pattern is bounded, and the input is capped.
// Each 200 KB adversarial input must mask in < 200 ms; ordinary results are as before.
import { describe, expect, it } from "vitest";
import { MASK_TEXT_MAX_CHARS, maskText } from "./mask";

const KB = 1024;
const rep = (unit: string, size = 200 * KB) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
function bestMs(f: () => void): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    f();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** The pre-fix e-mail pattern, for the "results unchanged" check on ordinary text. */
const OLD_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

describe("NEW-13: maskText is linear", () => {
  it.each([
    ["a long run of local-part characters with no @ (the PoC)", rep("a")],
    ["dots and underscores, no @", rep("a._")],
    ["'a@' repeated", rep("a@")],
    ["'a@b' with no dot", rep("a@b ")],
    ["digits (Aadhaar / phone shapes)", rep("9")],
    ["PAN-ish runs", rep("ABCDE1234")],
    ["mixed realistic context lines", rep("Client code KUM01 · rajesh.k@example.com · PAN ABCDE1234F · 98765 43210 · ")],
  ])("%s: 200 KB in < 200 ms", (_n, text) => {
    expect(bestMs(() => maskText(text))).toBeLessThan(200);
  });

  it("an over-long input is cut at the cap", () => {
    const out = maskText(rep("x", MASK_TEXT_MAX_CHARS + 50));
    expect(out.length).toBe(MASK_TEXT_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("results are as before on ordinary text", () => {
    const samples = [
      "Mail rajesh.k@example.com or accounts@acme-widgets.co.in today",
      "AAAPA1234A_PAN.pdf in CL-KUM01/Compliance",
      "GSTIN 29ABCDE1234F1Z5, PAN ABCDE1234F, Aadhaar 2345 6789 0123, mobile +91 98765 43210",
      "no identifiers here",
      "a@b (not an email), x@y.z",
    ];
    const oldMask = (t: string) => maskText(t.replace(OLD_EMAIL, (m) => `${m[0].toLowerCase()}***@${m.slice(m.lastIndexOf("@") + 1).toLowerCase()}`));
    for (const s of samples) expect(maskText(s), s).toBe(oldMask(s));
    expect(maskText("Mail rajesh.k@example.com")).toBe("Mail r***@example.com");
  });
});

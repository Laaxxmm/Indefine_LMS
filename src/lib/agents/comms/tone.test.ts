// Tone lint (Phase 10): banned words as data, at most 180 English words, one ask, no emoji.
import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "./banned-words";
import { asks, countAsks, countWords, lintTone, sentences, toneKey } from "./tone";

const codes = (text: string, o?: Parameters<typeof lintTone>[1]) => lintTone(text, o).map((i) => i.code);

describe("banned words", () => {
  it("flags every entry of the list, case-insensitively, on word boundaries", () => {
    for (const w of BANNED_WORDS) {
      const issues = lintTone(`We wrote ${w.phrase.toUpperCase()} here.`);
      expect(issues.map(toneKey), w.phrase).toContain(`banned-word:${w.phrase}`);
      expect(issues.find((i) => i.phrase === w.phrase)?.message).toContain(w.instead);
    }
  });

  it("does not flag a banned word inside a longer word", () => {
    expect(codes("The remittance advice is attached. Soonest is not a word we use, and Switch is fine.")).toEqual([]);
  });

  it("names the plain alternative", () => {
    expect(lintTone("Kindly revert at the earliest.").map((i) => i.phrase)).toEqual(["kindly", "revert", "at the earliest"]);
  });

  it("the list is data: every entry has a phrase, a category and an alternative, no duplicates", () => {
    const phrases = BANNED_WORDS.map((w) => w.phrase.toLowerCase());
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const w of BANNED_WORDS) expect(w.phrase.trim() && w.category && w.instead.trim()).toBeTruthy();
  });
});

describe("length", () => {
  it("counts words, not symbols", () => {
    expect(countWords("Pay ₹1,23,456.00 by 20 Nov 2026 — thanks")).toBe(7);
  });
  it("180 words pass, 181 fail; a translation is not word-capped", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(codes(words(180))).toEqual([]);
    expect(codes(words(181))).toEqual(["too-long"]);
    expect(codes(words(400), { english: false })).toEqual([]);
  });
});

describe("one ask per message", () => {
  it("counts request sentences and questions", () => {
    expect(countAsks("We need these. Please send them by 20 Nov 2026.")).toBe(1);
    expect(asks("Could you check this? Please send the bank statement.")).toHaveLength(2);
    expect(codes("Please send the register. Please also confirm the payment.")).toEqual(["more-than-one-ask"]);
  });
  it("a message that must ask for something without an ask is flagged", () => {
    expect(codes("Your return is due on 20 Nov 2026.", { requireAsk: true })).toEqual(["no-ask"]);
    expect(codes("Your return is due on 20 Nov 2026.")).toEqual([]);
  });
  it("splits sentences at full stops followed by a capital, and at line breaks", () => {
    expect(sentences("Acme Traders Pvt. Ltd. owes ₹1,000.00. Please pay.\n- Item one")).toEqual(["Acme Traders Pvt.", "Ltd. owes ₹1,000.00.", "Please pay.", "- Item one"]);
  });
});

describe("calm tone", () => {
  it("no emoji, no exclamation marks", () => {
    expect(codes("Filed \u{1F389}")).toEqual(["emoji"]);
    expect(codes("Filed ✅")).toEqual(["emoji"]);
    expect(codes("Filed!")).toEqual(["exclamation"]);
    expect(codes("ಫೈಲ್ ಆಗಿದೆ!", { english: false })).toEqual(["exclamation"]);
  });
});

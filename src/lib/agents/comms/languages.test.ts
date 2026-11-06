// Languages (Phase 10): English first, then the translation by a separate scoped task; the English
// is always kept beside it. Snapshot of a Kannada draft from a recorded model response; a
// translation that changes a fact or uses native digits is rejected and the draft stays English.
import { describe, expect, it } from "vitest";
import { ENGLISH_DIVIDER, bilingual, draftMessage, splitBilingual, type DraftRequest } from "./compose";
import { toSegments } from "./drafting";
import { validateTranslation, type TranslateOutput } from "./grounding";
import { SAMPLES } from "../../../../tests/fakes/comms-fixtures";
import { scriptedRouter, sentText, unfence } from "../../../../tests/fakes/comms-router";

const req = (kind: keyof typeof SAMPLES, over: Partial<DraftRequest> = {}): DraftRequest => ({ ...SAMPLES[kind], department: "GST", language: "kn", clientRequestedIds: false, ...over }) as DraftRequest;
const deps = (router: ReturnType<typeof scriptedRouter>["router"]) => ({ router, runId: "comms:test-kn", maxCostInr: 10 });
const keep = (_r: unknown, input: Record<string, unknown>) => ({ status: "polished", subject: input.subject, paragraphs: input.paragraphs });

/** Recorded comms.translate.gst answer for the status update (masked names, English digits). */
const RECORDED_KN = {
  status: "translated",
  language: "kn",
  segments: [
    "October 2026 ರ GSTR-3B (⟨ORG_1⟩): ಕೆಲಸದ ಸ್ಥಿತಿ",
    "ಆತ್ಮೀಯ ⟨NAME_1⟩,",
    "ನಿಮ್ಮ October 2026 ರ GSTR-3B ಕುರಿತು ಇದು ಮಾಹಿತಿ.",
    "ಅದನ್ನು ಸಿದ್ಧಪಡಿಸಲಾಗಿದೆ ಮತ್ತು ನಮ್ಮ ತಂಡ ಅದನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದೆ.",
    "ಫೈಲ್ ಮಾಡಲು ಕೊನೆಯ ದಿನಾಂಕ 20 Nov 2026.",
    "ವಂದನೆಗಳು,",
  ],
};

describe("translation", () => {
  it("Kannada: translated draft with the English alongside (recorded model response)", async () => {
    const r = scriptedRouter([keep, RECORDED_KN]);
    const out = await draftMessage(req("status"), deps(r.router));
    expect(out).toMatchObject({ language: "kn", requestedLanguage: "kn", sources: { wording: "model", translation: "model" }, notes: [] });
    expect(out.stored.body).toMatchSnapshot();
    expect(out.stored.subject).toBe("October 2026 ರ GSTR-3B (Acme Traders Private Limited): ಕೆಲಸದ ಸ್ಥಿತಿ / GSTR-3B for October 2026 (Acme Traders Private Limited): status update");
    expect(splitBilingual(out.stored.body)).toEqual({ translated: out.translated!.body, english: out.english.body });
    expect(out.translated!.body.endsWith("ವಂದನೆಗಳು,\nPriya Sharma\nIndefine")).toBe(true); // the signature is not translated

    // Two scoped calls, both anonymised; the translation task is its own task (smart tier).
    expect(r.rows.map((x) => [x.task, x.tier, x.anonymized, x.status])).toEqual([
      ["comms.polish.gst@2", "FAST", true, "OK"],
      ["comms.translate.gst@2", "SMART", true, "OK"],
    ]);
    expect(sentText(r.calls)).not.toMatch(/Acme Traders|Ravi Kumar/);
    expect(JSON.parse(unfence(r.calls[1].messages[0].content))).toEqual({
      language: "kn",
      segments: [
        "GSTR-3B for October 2026 (⟨ORG_1⟩): status update",
        "Dear ⟨NAME_1⟩,",
        "This is an update on your GSTR-3B for October 2026.",
        "It is prepared and our team is reviewing it.",
        "The due date for filing is 20 Nov 2026.",
        "Regards,",
      ],
    });
  });

  it("a translation that changes a date or uses native digits is rejected; the draft stays English with a note", async () => {
    const bad = { ...RECORDED_KN, segments: RECORDED_KN.segments.map((s) => s.replace("20 Nov 2026", "೨೦ Nov ೨೦೨೬")) };
    const r = scriptedRouter([keep, bad, bad]);
    const out = await draftMessage(req("status"), deps(r.router));
    expect(out).toMatchObject({ language: "en", requestedLanguage: "kn", translated: null, sources: { translation: "failed" } });
    expect(out.stored).toEqual(out.english);
    expect(out.notes).toEqual(["No translation: the model's translation did not pass the fact and tone checks. The English is used on its own."]);
    expect(r.rows.slice(1).map((x) => [x.tier, x.status])).toEqual([
      ["SMART", "LOW_CONFIDENCE"],
      ["HARD", "LOW_CONFIDENCE"],
    ]);
  });

  it("the model may decline to translate; no model at all leaves English with a note", async () => {
    const r = scriptedRouter([keep, { status: "insufficient_evidence", language: "ta", segments: ["x"] }]);
    const out = await draftMessage(req("status", { language: "ta" }), deps(r.router));
    expect(out.notes).toEqual(["No translation: the model could not translate this message faithfully into Tamil; the English is used on its own."]);
    const none = await draftMessage(req("status", { language: "hi" }), null);
    expect(none.notes).toContain("No translation into Hindi: no model was asked. The English is used on its own.");
    const off = await draftMessage(req("status", { language: "hi" }), deps(scriptedRouter([], { available: false }).router));
    expect(off.notes[1]).toMatch(/^No translation: the drafting model is not available/);
  });

  it("doc-chase in Hindi: list items and their numbers are translated segment by segment and put back in place", async () => {
    const recorded = {
      status: "translated",
      language: "hi",
      segments: [
        "आवश्यक दस्तावेज़: October 2026 का GSTR-3B (⟨ORG_1⟩)",
        "प्रिय ⟨NAME_1⟩,",
        "October 2026 का आपका GSTR-3B पूरा करने के लिए हमें नीचे दिए गए दस्तावेज़ चाहिए।",
        "कृपया इन्हें 12 Nov 2026 तक भेजें।",
        "फ़ाइल करने की अंतिम तारीख 20 Nov 2026 है।",
        "Sharma Steels से 03 Oct 2026 का खरीद चालान INV-104",
        "October 2026 का बैंक स्टेटमेंट",
        "सादर,",
      ],
    };
    const r = scriptedRouter([keep, recorded]);
    const out = await draftMessage(req("doc-chase", { language: "hi" }), deps(r.router));
    expect(out.notes).toEqual([]);
    expect(out.translated?.body).toBe(
      [
        "प्रिय Ravi Kumar,",
        "October 2026 का आपका GSTR-3B पूरा करने के लिए हमें नीचे दिए गए दस्तावेज़ चाहिए।",
        "- Sharma Steels से 03 Oct 2026 का खरीद चालान INV-104\n- October 2026 का बैंक स्टेटमेंट",
        "कृपया इन्हें 12 Nov 2026 तक भेजें।",
        "फ़ाइल करने की अंतिम तारीख 20 Nov 2026 है।",
        "सादर,\nPriya Sharma\nIndefine",
      ].join("\n\n"),
    );
  });
});

describe("validateTranslation", () => {
  const segments = ["Please send them by 12 Nov 2026.", "Regards,"];
  const facts = [{ kind: "date" as const, value: "12 Nov 2026" }];
  const out = (s: string[], language: TranslateOutput["language"] = "kn"): TranslateOutput => ({ status: "translated", language, segments: s });
  const v = (o: TranslateOutput) => validateTranslation(o, { language: "kn", segments, facts });

  it("accepts a faithful translation", () => {
    expect(v(out(["ದಯವಿಟ್ಟು 12 Nov 2026 ರೊಳಗೆ ಕಳುಹಿಸಿ.", "ವಂದನೆಗಳು,"]))).toEqual([]);
  });
  it("rejects the wrong language, segment count, script, a changed date, a new number, emoji", () => {
    expect(v(out(["a", "b"], "ta"))[0]).toMatch(/translate into "kn"/);
    expect(v(out(["only one"]))[0]).toMatch(/exactly 2 segments/);
    expect(v(out(["Please send them by 12 Nov 2026.", "Regards,"]))).toContain("segment 1: not translated into the requested script");
    const changed = v(out(["ದಯವಿಟ್ಟು 13 Nov 2026 ರೊಳಗೆ 2 ದಿನಗಳಲ್ಲಿ ಕಳುಹಿಸಿ \u{1F600}", "ವಂದನೆಗಳು,"]));
    expect(changed).toContain('segment 1: copy the date "12 Nov 2026" exactly, in English letters and digits');
    expect(changed.join("\n")).toMatch(/a number, date or reference that is not one of the facts/);
    expect(changed.join("\n")).toMatch(/no emoji/);
  });
  it("accepts insufficient_evidence", () => {
    expect(v({ status: "insufficient_evidence", language: "kn", segments: [] })).toEqual([]);
  });
});

describe("bilingual storage", () => {
  it("translation first, then the English, split back exactly", () => {
    const b = bilingual({ subject: "ವಿಷಯ", body: "ದೇಹ" }, { subject: "Subject", body: "Body\n\nmore" });
    expect(b).toEqual({ subject: "ವಿಷಯ / Subject", body: `ದೇಹ\n\n${ENGLISH_DIVIDER}\n\nBody\n\nmore` });
    expect(splitBilingual(b.body)).toEqual({ translated: "ದೇಹ", english: "Body\n\nmore" });
    expect(splitBilingual("Body only")).toEqual({ translated: null, english: "Body only" });
  });
  it("segments: subject, greeting, sentences, items, closing — and back", () => {
    const parts = { subject: "S", greeting: "Dear X,", paragraphs: ["One. Two.", "Three."], items: ["Item A"], closing: "Regards," };
    const { segments, fromSegments } = toSegments(parts);
    expect(segments).toEqual(["S", "Dear X,", "One.", "Two.", "Three.", "Item A", "Regards,"]);
    expect(fromSegments(segments)).toEqual(parts);
  });
});

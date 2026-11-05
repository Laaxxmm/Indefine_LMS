// Security findings #7 / #11 (audit PoC 06): legacy Gemini paths sent staff free text (SOP Builder,
// ≤ 50 KB) and live-session recordings / transcripts (automatically, every 15 minutes) unmasked.
// Now every text prompt is masked and gated (legacy-gate.ts); a recording is never uploaded and a
// transcript masking cannot cover parks the session for an admin. fetch and Prisma are fakes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verhoeffCheckDigit } from "@/lib/ai/anonymizer";
import { LegacyGateError, PARKED_MESSAGE, gateForGemini, transcriptGate } from "@/lib/ai/legacy-gate";

const ROOT = join(__dirname, "..", "..", "..");
const AADHAAR = "23456789012" + verhoeffCheckDigit("23456789012");

// ---- fake Prisma for auto-quiz / live ingest (only what those paths touch)
const db = {
  audits: [] as { action: string; entity: string; entityId: string | null; meta?: unknown }[],
  videos: new Map<string, { id: string; title: string; description: string | null; sourceText: string | null; graphDriveId: string; graphItemId: string; quiz: null }>(),
  sessions: [] as { id: string; recordedVideoId: string }[],
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: {
      create: async ({ data }: { data: { action: string; entity: string; entityId: string | null; meta?: unknown } }) => (db.audits.push(data), { id: `a${db.audits.length}` }),
      count: async ({ where }: { where: { action: string; entity: string; entityId: string } }) => db.audits.filter((a) => a.action === where.action && a.entity === where.entity && a.entityId === where.entityId).length,
    },
    video: { findUnique: async ({ where }: { where: { id: string } }) => db.videos.get(where.id) ?? null, update: async () => ({}) },
    liveSession: { findFirst: async ({ where }: { where: { recordedVideoId: string } }) => db.sessions.find((s) => s.recordedVideoId === where.recordedVideoId) ?? null },
    client: { findMany: async () => [{ name: "Kestrel Widgets Pvt Ltd", contactName: "Zorvan Mandravel" }] },
    user: { findMany: async () => [{ name: "Ilsha Ostrakar" }] },
  },
}));
vi.mock("@/lib/graph", () => ({ getAppOnlyToken: async () => "t", getUserGraphToken: async () => "t", getStreamUrl: async () => "https://graph.example/video.mp4" }));
vi.mock("@/lib/settings", () => ({ getQuizDefaults: async () => ({}) }));

const bodies: { url: string; body: string }[] = [];
beforeEach(() => {
  bodies.length = 0;
  db.audits.length = 0;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/v1beta/models?")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
      bodies.push({ url: u, body: String(init?.body ?? "") });
      // The model echoes the placeholders it saw in the brief's objective.
      const sent = String(init?.body ?? "");
      const tokens = [...new Set(sent.match(/⟨[A-Z_]+_\d+⟩/g) ?? [])].join(" ");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ valid: true, brief: { title: "t", department: "TAX", workCategory: "w", objective: `for ${tokens}`, scope: "s", keySteps: ["a"], rolesInvolved: ["r"], references: [] } }) }] } }] }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

describe("#7 SOP Builder: staff free text is masked and gated before Gemini", () => {
  const raw = `For client Rajesh Kumar (PAN ABCDE1234F, Aadhaar ${AADHAAR}, mob 9876543210, rajesh@example.com) we file GSTR-3B monthly.`;
  const input = { title: "GST filing", department: "TAX", workCategory: "GST", purpose: "p", rawProcedure: raw };

  it("PoC 06: nothing identifying reaches the request body; the brief comes back with the values", async () => {
    const { analyzeSopRequest } = await import("@/lib/sop/gemini");
    const out = await analyzeSopRequest(input, { dictionary: async () => [{ value: "Rajesh Kumar", kind: "NAME" }] });
    const sent = bodies.map((b) => b.body).join("\n");
    expect(bodies[0].url).toContain("generativelanguage.googleapis.com");
    for (const s of ["ABCDE1234F", AADHAAR, "9876543210", "rajesh@example.com", "Rajesh Kumar"]) expect(sent).not.toContain(s);
    expect(sent).toMatch(/⟨PAN_1⟩/);
    expect(out.brief?.objective).toContain("ABCDE1234F"); // restored for the author
    expect(bodies[0].url).not.toContain("test-key-not-real");
  });

  it("the production default reads the client master + staff names (here: the fake database)", async () => {
    const { analyzeSopRequest } = await import("@/lib/sop/gemini");
    await analyzeSopRequest({ ...input, rawProcedure: "Zorvan Mandravel of Kestrel Widgets Pvt Ltd sends the sales register; Ilsha Ostrakar reviews it." });
    const sent = bodies.map((b) => b.body).join("\n");
    for (const s of ["Zorvan", "Kestrel Widgets", "Ilsha"]) expect(sent).not.toContain(s);
  });

  it("no dictionary → nothing is sent (fail closed)", async () => {
    const { analyzeSopRequest } = await import("@/lib/sop/gemini");
    await expect(analyzeSopRequest(input, { dictionary: async () => Promise.reject(new Error("db down")) })).rejects.toThrow();
    expect(bodies).toHaveLength(0);
  });

  it("gateForGemini masks with the dictionary and restores the answer; its refusal reads plainly", () => {
    const g = gateForGemini("Client Zorvan Mandravel, PAN ABCDE1234F", { dictionary: [{ value: "Zorvan Mandravel", kind: "NAME" }] });
    expect(g.prompt).toBe("Client ⟨NAME_1⟩, PAN ⟨PAN_1⟩");
    expect(g.restore("Brief for ⟨NAME_1⟩")).toBe("Brief for Zorvan Mandravel");
    // (The refusal path itself is proven with a no-op masker in leak-gate.test.ts.)
    expect(new LegacyGateError(["PAN"], "This procedure").message).toMatch(/^This procedure contains client details that could not be hidden from the AI \(PAN\), so it was not sent/);
  });
});

describe("#11 live sessions: a recording is never uploaded; a transcript masking cannot cover is parked", () => {
  it("transcriptGate: spoken numbers park; masked client data is sent masked", () => {
    expect(transcriptGate("call me on nine eight seven six five four three two one zero after the session", [])).toEqual({ send: false, reasons: ["numbers spoken as words"] });
    const ok = transcriptGate(`Today we discuss GSTR-3B. Example PAN ABCDE1234F for Zorvan Mandravel.`, [{ value: "Zorvan Mandravel", kind: "NAME" }]);
    expect(ok).toEqual({ send: true, masked: 2 });
  });

  it("autoQuizFromVideo on a live-session recording without a transcript parks it instead of uploading the video", async () => {
    db.videos.set("v1", { id: "v1", title: "Client call", description: null, sourceText: null, graphDriveId: "d", graphItemId: "i", quiz: null });
    db.sessions.push({ id: "s1", recordedVideoId: "v1" });
    const { autoQuizFromVideo, GEMINI_PARKED_ACTION } = await import("@/lib/auto-quiz");
    const res = await autoQuizFromVideo("v1");
    expect(res).toMatchObject({ ok: false, skipped: "parked", error: PARKED_MESSAGE });
    expect(bodies).toHaveLength(0); // no upload, no generateContent
    expect(db.audits).toEqual([expect.objectContaining({ action: GEMINI_PARKED_ACTION, entity: "LiveSession", entityId: "s1" })]);
  });

  it("a live-session transcript with spoken account numbers is parked; nothing goes to Gemini", async () => {
    const transcript = "Welcome to the GST session. ".repeat(10) + "The account is five zero one zero zero one two three four five six. " + "We will discuss ITC. ".repeat(5);
    db.videos.set("v2", { id: "v2", title: "Session 2", description: null, sourceText: transcript, graphDriveId: "d", graphItemId: "i", quiz: null });
    db.sessions.push({ id: "s2", recordedVideoId: "v2" });
    const { autoQuizFromVideo } = await import("@/lib/auto-quiz");
    const res = await autoQuizFromVideo("v2", { noVideoFallback: true, difficulty: "HARD" });
    expect(res).toMatchObject({ ok: false, skipped: "parked" });
    expect(bodies).toHaveLength(0);
    expect(JSON.stringify(db.audits)).not.toContain("five zero one");
  });
});

describe("static: data handling is recorded", () => {
  it("ADR-002 records the Gemini data-handling note with the owner's paid-tier confirmation", () => {
    const adr = readFileSync(join(ROOT, "docs/adr/ADR-002-model-router.md"), "utf8");
    expect(adr).toMatch(/Gemini data handling \(owner to confirm the paid tier\)/);
    expect(adr).toMatch(/parked for an admin/);
  });
});

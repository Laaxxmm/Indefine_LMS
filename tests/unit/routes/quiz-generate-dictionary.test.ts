// Admin quiz generation (POST /api/admin/quiz/generate and the /admin/video/[id] "generate and add"
// action) masks client and staff names in the source text with the same name dictionary as SOP
// Builder and the automatic quiz (client master + staff, src/lib/ai/name-directory.ts). If the
// dictionary cannot be loaded, nothing is sent to Gemini (fail closed, as auto-quiz.ts does).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./harness";

const state = vi.hoisted(() => ({
  dictionary: [{ name: "Kumar Traders", kind: "org" }, { name: "Priya Raman", kind: "person" }] as unknown[] | null,
  generate: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    video: {
      findUnique: async () => ({ id: "v1", title: "GST basics", description: null, sourceText: "", quiz: null, materials: [], embedUrl: null, durationSeconds: 0, published: false, createdAt: new Date() }),
      update: async () => ({}),
    },
    quiz: { findUnique: async () => ({ id: "q1" }), create: async () => ({ id: "q1" }) },
    question: { count: async () => 0, create: async () => ({}) },
  },
}));
vi.mock("@/lib/ai/name-directory", () => ({
  loadFirmNameDictionary: async () => {
    if (!state.dictionary) throw new Error("db down");
    return state.dictionary;
  },
}));
vi.mock("@/lib/quiz-gen", () => ({
  generateQuiz: async (input: Record<string, unknown>) => (state.generate.push(input), { ok: true, questions: [], dropped: 0 }),
}));

const { auth } = await import("@/lib/auth");
const route = await import("@/app/api/admin/quiz/generate/route");
const asAdmin = () => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-admin", role: "ADMIN" }));
const SOURCE = "Kumar Traders asked Priya Raman about the GST refund. ".repeat(10);
const post = () => new Request("http://x/api/admin/quiz/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: "v1", sourceText: SOURCE, count: 5, difficulty: "MEDIUM" }) });

beforeEach(() => {
  state.generate.length = 0;
  state.dictionary = [{ name: "Kumar Traders", kind: "org" }, { name: "Priya Raman", kind: "person" }];
});

describe("POST /api/admin/quiz/generate", () => {
  it("passes the client master + staff name dictionary to generateQuiz", async () => {
    asAdmin();
    const r = await route.POST(post());
    expect(r.status).toBe(200);
    expect(state.generate).toHaveLength(1);
    expect(state.generate[0].dictionary).toEqual(state.dictionary);
  });

  it("fails closed when the dictionary cannot be loaded: nothing is sent, a plain sentence comes back", async () => {
    asAdmin();
    state.dictionary = null;
    const r = await route.POST(post());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, error: "The list of client and staff names to hide from the AI could not be loaded, so nothing was sent. Try again later." });
    expect(state.generate).toEqual([]);
  });
});

describe("/admin/video/[id] generate-and-add action", () => {
  type Action = (d: { videoId: string; sourceText: string; count: number; difficulty: "MEDIUM" }) => Promise<{ ok: boolean; error?: string }>;
  async function action(): Promise<Action> {
    const { default: Page } = await import("@/app/admin/video/[id]/page");
    const { QuizAI } = await import("@/app/admin/video/[id]/QuizAI");
    const find = (node: unknown): Action | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
      const el = node as { type?: unknown; props?: { children?: unknown; generateAndAddAction?: Action } };
      if (el.type === QuizAI) return el.props!.generateAndAddAction!;
      return find(el.props?.children);
    };
    const tree = await Page({ params: Promise.resolve({ id: "v1" }), searchParams: Promise.resolve({}) });
    return find(tree)!;
  }

  it("passes the dictionary, and sends nothing when it cannot be loaded", async () => {
    asAdmin();
    const run = await action();
    expect(await run({ videoId: "v1", sourceText: SOURCE, count: 5, difficulty: "MEDIUM" })).toMatchObject({ ok: true });
    expect(state.generate.at(-1)!.dictionary).toEqual(state.dictionary);
    state.dictionary = null;
    const n = state.generate.length;
    expect(await run({ videoId: "v1", sourceText: SOURCE, count: 5, difficulty: "MEDIUM" })).toEqual({ ok: false, error: "The list of client and staff names to hide from the AI could not be loaded, so nothing was sent. Try again later." });
    expect(state.generate).toHaveLength(n);
  });
});

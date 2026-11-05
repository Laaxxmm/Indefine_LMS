// A ModelRouter stand-in that answers from recorded outputs keyed by task (no network, no
// clock, no randomness). The accuracy harness uses one per fixture; framework tests use it to
// drive the runner. Outputs are validated against the caller's Zod schema exactly as the real
// router does, so a recording that no longer fits the schema surfaces as "needs-review"; the
// caller's `contradictions` validators run too (an issue → "needs-review" with the output, as the
// real router returns after its last escalation).
//
// Agreement re-asks (ADR-008, `secondOpinion: true`) are answered from the `<task>#2` recording
// when the fixture has one; otherwise the same answer is reused (agreement trivially true — the
// harness notes it as "recorded single answer").
import type { ModelRequest, RouterResult } from "@/lib/ai/router";
import type { ModelRouterLike } from "./runner";

/** task → the model's `output` for that task (e.g. "echo.check:echo.related-party"; "<task>#2" for the agreement re-ask). */
export type RecordedResponses = Record<string, unknown>;

/** Suffix of the recording that answers the second (agreement) read of a task. */
export const SECOND_OPINION_SUFFIX = "#2";

export class MissingRecordingError extends Error {
  constructor(task: string) {
    super(`No recorded model response for task "${task}"`);
    this.name = "MissingRecordingError";
  }
}

export type RecordedRouter = ModelRouterLike & {
  readonly calls: ModelRequest<unknown>[];
  /** Recording keys each call looked up, in call order ("<task>" or "<task>#2"). */
  readonly asked: string[];
};

/** The recording key a request is answered from. */
export const recordingKey = (req: Pick<ModelRequest, "task" | "secondOpinion">): string => (req.secondOpinion ? `${req.task}${SECOND_OPINION_SUFFIX}` : req.task);

export function createRecordedRouter(responses: RecordedResponses | ((req: ModelRequest<unknown>, n: number) => unknown)): RecordedRouter {
  const calls: ModelRequest<unknown>[] = [];
  const asked: string[] = [];
  const has = (k: string) => typeof responses !== "function" && Object.prototype.hasOwnProperty.call(responses, k);
  return {
    calls,
    asked,
    async run<T>(req: ModelRequest<T>): Promise<RouterResult<T>> {
      calls.push(req as ModelRequest<unknown>);
      const key = recordingKey(req);
      asked.push(key);
      let output: unknown;
      if (typeof responses === "function") output = responses(req as ModelRequest<unknown>, calls.length);
      else if (has(key)) output = structuredClone(responses[key]);
      else if (has(req.task)) output = structuredClone(responses[req.task]); // single recorded answer reused for the re-ask
      else throw new MissingRecordingError(req.task);
      const meta = { provider: "local" as const, model: "recorded", confidence: 1, escalated: false, anonymized: false, tokensIn: 0, tokensOut: 0, costInr: 0, attempts: 1 };
      if (req.schema) {
        const parsed = req.schema.safeParse(output);
        if (!parsed.success) {
          return { ...meta, status: "needs-review", output: null, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), needsPartnerReview: true };
        }
        const found = req.contradictions ? await req.contradictions(parsed.data) : [];
        if (found.length) return { ...meta, status: "needs-review", output: parsed.data, issues: found.map((f) => `contradiction: ${f}`), needsPartnerReview: true };
        return { ...meta, status: "ok", output: parsed.data, needsPartnerReview: false };
      }
      return { ...meta, status: "ok", output: output as T, needsPartnerReview: false };
    },
  };
}

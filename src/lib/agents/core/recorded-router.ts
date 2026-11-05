// A ModelRouter stand-in that answers from recorded outputs keyed by task (no network, no
// clock, no randomness). The accuracy harness uses one per fixture; framework tests use it to
// drive the runner. Outputs are validated against the caller's Zod schema exactly as the real
// router does, so a recording that no longer fits the schema surfaces as "needs-review".
import type { ModelRequest, RouterResult } from "@/lib/ai/router";
import type { ModelRouterLike } from "./runner";

/** task → the model's `output` for that task (e.g. "system.echo-extract", "system.check:echo.related-party"). */
export type RecordedResponses = Record<string, unknown>;

export class MissingRecordingError extends Error {
  constructor(task: string) {
    super(`No recorded model response for task "${task}"`);
    this.name = "MissingRecordingError";
  }
}

export type RecordedRouter = ModelRouterLike & { readonly calls: ModelRequest<unknown>[] };

export function createRecordedRouter(responses: RecordedResponses | ((req: ModelRequest<unknown>, n: number) => unknown)): RecordedRouter {
  const calls: ModelRequest<unknown>[] = [];
  return {
    calls,
    async run<T>(req: ModelRequest<T>): Promise<RouterResult<T>> {
      calls.push(req as ModelRequest<unknown>);
      let output: unknown;
      if (typeof responses === "function") output = responses(req as ModelRequest<unknown>, calls.length);
      else if (Object.prototype.hasOwnProperty.call(responses, req.task)) output = structuredClone(responses[req.task]);
      else throw new MissingRecordingError(req.task);
      const meta = { provider: "local" as const, model: "recorded", confidence: 1, escalated: false, anonymized: false, tokensIn: 0, tokensOut: 0, costInr: 0, attempts: 1 };
      if (req.schema) {
        const parsed = req.schema.safeParse(output);
        if (!parsed.success) {
          return { ...meta, status: "needs-review", output: null, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), needsPartnerReview: true };
        }
        return { ...meta, status: "ok", output: parsed.data, needsPartnerReview: false };
      }
      return { ...meta, status: "ok", output: output as T, needsPartnerReview: false };
    },
  };
}

// Token cost in rupees. Claude list prices (USD per million tokens, input / output) are from the
// claude-api skill model table (cached 2026-10-06). Grok is configurable (GROK_PRICE_*), local is
// free. An unknown Claude model is priced at the most expensive listed rate so the budget guard
// errs on the side of refusing, never of under-counting.
import type { ProviderId } from "./types";

export interface UsdPerMTok {
  input: number;
  output: number;
}

export const CLAUDE_PRICES: Record<string, UsdPerMTok> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
/** Haiku 5.5 is billed at a higher rate for prompts above 100K input tokens. */
const HAIKU_55_LONG: UsdPerMTok = { input: 0.5, output: 2.5 };
const UNKNOWN_CLAUDE: UsdPerMTok = { input: 5, output: 25 };

export interface PriceContext {
  usdInr: number;
  grokPriceUsdPerMTok: UsdPerMTok;
}

export function priceFor(provider: ProviderId, model: string, tokensIn: number, ctx: PriceContext): UsdPerMTok {
  if (provider === "local") return { input: 0, output: 0 };
  if (provider === "grok") return ctx.grokPriceUsdPerMTok;
  if (model === "claude-haiku-5-5" && tokensIn > 100_000) return HAIKU_55_LONG;
  return CLAUDE_PRICES[model] ?? UNKNOWN_CLAUDE;
}

/** Rupee cost, rounded to 4 decimals (ModelCall.costInr is Decimal(12,4)). */
export function costInr(provider: ProviderId, model: string, tokensIn: number, tokensOut: number, ctx: PriceContext): number {
  const p = priceFor(provider, model, tokensIn, ctx);
  const usd = (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
  return Math.round(usd * ctx.usdInr * 10_000) / 10_000;
}

/** Rough input-token estimate (≈4 chars per token) for the pre-call budget check. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

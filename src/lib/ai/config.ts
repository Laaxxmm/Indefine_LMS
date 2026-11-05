// ModelRouter configuration, read from env in one place. Pure: pass an env object in tests.
// Model IDs and Claude prices come from the claude-api skill model table (cached 2026-10-06):
// Haiku 5.5 / Sonnet 5.5 / Opus 5.5 are the current generation of the fast / smart / hard tiers.

export interface RouterConfig {
  anthropicApiKey: string;
  xaiApiKey: string;
  localBaseUrl: string;
  models: { FAST: string; SMART: string; HARD: string; GROK: string; LOCAL: string };
  /** Below this confidence the router escalates (ROUTER_MIN_CONF, default 0.75). */
  minConfidence: number;
  /** Per-day cap across all runs, IST calendar day (AI_DAILY_BUDGET_INR). 0 = no cap. */
  dailyBudgetInr: number;
  usdInr: number;
  grokPriceUsdPerMTok: { input: number; output: number };
  defaultMaxTokens: number;
  timeoutMs: number;
}

export const DEFAULT_MODELS = {
  FAST: "claude-haiku-5-5",
  SMART: "claude-sonnet-5-5",
  HARD: "claude-opus-5-5",
  GROK: "grok-4",
  LOCAL: "local-open-weight",
} as const;

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback: string): string {
  const v = env[key]?.trim();
  return v ? v : fallback;
}
function num(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function loadRouterConfig(env: Env = process.env): RouterConfig {
  const minConfidence = num(env, "ROUTER_MIN_CONF", 0.75);
  return {
    anthropicApiKey: str(env, "ANTHROPIC_API_KEY", ""),
    xaiApiKey: str(env, "XAI_API_KEY", ""),
    localBaseUrl: str(env, "LOCAL_LLM_BASE_URL", ""),
    models: {
      FAST: str(env, "MODEL_FAST", DEFAULT_MODELS.FAST),
      SMART: str(env, "MODEL_SMART", DEFAULT_MODELS.SMART),
      HARD: str(env, "MODEL_HARD", DEFAULT_MODELS.HARD),
      GROK: str(env, "GROK_MODEL", DEFAULT_MODELS.GROK),
      LOCAL: str(env, "LOCAL_LLM_MODEL", DEFAULT_MODELS.LOCAL),
    },
    minConfidence: minConfidence > 1 ? 0.75 : minConfidence,
    dailyBudgetInr: num(env, "AI_DAILY_BUDGET_INR", 1000),
    usdInr: num(env, "USD_INR", 88, 1),
    grokPriceUsdPerMTok: {
      input: num(env, "GROK_PRICE_IN_USD_PER_MTOK", 3),
      output: num(env, "GROK_PRICE_OUT_USD_PER_MTOK", 15),
    },
    defaultMaxTokens: num(env, "AI_MAX_OUTPUT_TOKENS", 4096, 1),
    timeoutMs: num(env, "AI_TIMEOUT_MS", 60_000, 1000),
  };
}

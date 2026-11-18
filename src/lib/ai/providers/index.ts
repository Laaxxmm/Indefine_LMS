// Builds the three providers from RouterConfig. The router depends only on ModelProvider.
import type { RouterConfig } from "../config";
import type { ModelProvider, ProviderId } from "../types";
import { createClaudeProvider } from "./claude";
import { createGrokProvider } from "./grok";
import { createLocalProvider } from "./local";

export type ProviderSet = Record<ProviderId, ModelProvider>;

export function createProviders(config: RouterConfig): ProviderSet {
  return {
    claude: createClaudeProvider({ apiKey: config.anthropicApiKey, timeoutMs: config.timeoutMs }),
    grok: createGrokProvider({ apiKey: config.xaiApiKey, timeoutMs: config.timeoutMs }),
    local: createLocalProvider({ baseUrl: config.localBaseUrl }),
  };
}

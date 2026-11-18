// Production wiring: env config + PnP certificate token + Graph app-only token.
import { pnpBlockedAction, readSharePointConfig, type SharePointConfig } from "./config";
import { createSharePointClient, type ClientOptions, type SharePointClient } from "./graph-client";
import { createPnpTokenProvider } from "./sp-auth";

export function defaultSharePointClient(
  config: SharePointConfig = readSharePointConfig(),
  overrides: Omit<ClientOptions, "sharePointToken" | "sharePointBlockedAction"> = {},
): SharePointClient {
  return createSharePointClient({
    ...overrides,
    sharePointToken: config.pnp ? createPnpTokenProvider(config.pnp, { fetch: overrides.fetch }) : undefined,
    sharePointBlockedAction: pnpBlockedAction(config.pnpMissing),
  });
}

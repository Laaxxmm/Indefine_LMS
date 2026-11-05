// Error classes the providers throw and the router branches on. Providers translate SDK /
// HTTP failures into these so the router never sees a vendor-specific error type.
import type { ProviderId } from "./types";

export type ProviderErrorKind =
  | "outage" // 5xx, overloaded, network, timeout — after retries; the router fails over
  | "rate_limit" // 429 after retries; treated like an outage for failover
  | "auth" // 401/403 — configuration problem, surfaced
  | "bad_request" // 4xx other than the above — our bug, surfaced
  | "refusal"; // the model declined; surfaced (never silently retried elsewhere)

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  /** True when another provider may succeed where this one failed. */
  get failoverable(): boolean {
    return this.kind === "outage" || this.kind === "rate_limit";
  }
}

/** The provider is not configured or (local stub) not implemented. Fails closed. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/** The model answered but not with parseable JSON (or was cut off). Router escalates. */
export class ProviderOutputError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly tokensIn = 0,
    readonly tokensOut = 0,
  ) {
    super(message);
    this.name = "ProviderOutputError";
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly scope: "run" | "day",
    readonly limitInr: number,
    readonly spentInr: number,
  ) {
    super(
      scope === "run"
        ? `AI budget for this run is exhausted: ₹${spentInr.toFixed(2)} spent of ₹${limitInr.toFixed(2)} allowed (maxCostInr).`
        : `Daily AI budget is exhausted: ₹${spentInr.toFixed(2)} spent today (IST) of ₹${limitInr.toFixed(2)} allowed (AI_DAILY_BUDGET_INR).`,
    );
    this.name = "BudgetExceededError";
  }
}

/** No provider can serve this request (e.g. Claude down and no Grok key). */
export class NoProviderAvailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NoProviderAvailableError";
  }
}

// UiAutomationBridge — optional, OFF, and not built (ADR-003). When it is built it will drive
// the Turia web app with Playwright using the existing encrypted Neo Centra session, under
// three rules that this stub already encodes:
//
//   1. Disabled unless FIRM_OS_TURIA_UI=true (and FIRM_OS_TURIA_BRIDGE=UI). Default off.
//   2. Partner-only: the shared session belongs to a director, so every action is a partner's.
//   3. Read-first, dry-run default: lookups may run when enabled; writes only print the steps
//      they would take unless a partner switches dry-run off for that run.
//
// Today every method throws TuriaBlockedError with the human action, so the onboarding saga
// records a BLOCKED step instead of silently passing. No automation code exists here.
import type { TuriaAdapter, TuriaLookup, TuriaOpResult } from "./adapter";
import { TuriaBlockedError, UI_BRIDGE_DISABLED_ACTION, UI_BRIDGE_NOT_BUILT_ACTION, UI_BRIDGE_PARTNER_ONLY_ACTION } from "./errors";

type Env = Record<string, string | undefined>;

export function isTuriaUiEnabled(env: Env = process.env): boolean {
  return (env.FIRM_OS_TURIA_UI ?? "").trim().toLowerCase() === "true";
}

export interface UiBridgeOptions {
  env?: Env;
  /** Whether the person running this step is a partner (src/lib/rbac/policy.ts). */
  actorIsPartner?: boolean;
  /** Writes are dry-run unless a partner explicitly turns this off for one run. */
  dryRun?: boolean;
}

export class UiAutomationBridge implements TuriaAdapter {
  readonly mode = "UI" as const;
  readonly enabled: boolean;
  readonly dryRun: boolean;
  private readonly actorIsPartner: boolean;

  constructor(opts: UiBridgeOptions = {}) {
    this.enabled = isTuriaUiEnabled(opts.env);
    this.dryRun = opts.dryRun ?? true;
    this.actorIsPartner = opts.actorIsPartner ?? false;
  }

  private guard(): never {
    if (!this.enabled) throw new TuriaBlockedError(UI_BRIDGE_DISABLED_ACTION);
    if (!this.actorIsPartner) throw new TuriaBlockedError(UI_BRIDGE_PARTNER_ONLY_ACTION);
    throw new TuriaBlockedError(UI_BRIDGE_NOT_BUILT_ACTION);
  }

  async createClient(): Promise<TuriaOpResult> {
    return this.guard();
  }
  async addService(): Promise<TuriaOpResult> {
    return this.guard();
  }
  async createTask(): Promise<TuriaOpResult> {
    return this.guard();
  }
  async closeTask(): Promise<TuriaOpResult> {
    return this.guard();
  }
  async findClientByCode(): Promise<TuriaLookup> {
    return this.guard();
  }
}

// Picks the active Turia bridge from FIRM_OS_TURIA_BRIDGE (MANUAL | UI | API; default MANUAL).
// The mode is recorded on every TuriaSync row, so switching bridges later changes no gate logic.
import type { TuriaAdapter, TuriaMode } from "./adapter";
import { ApiBridge } from "./api-bridge";
import { ManualBridge, type TuriaSyncRepo } from "./manual-bridge";
import { UiAutomationBridge } from "./ui-bridge";

type Env = Record<string, string | undefined>;

const MODES: readonly TuriaMode[] = ["MANUAL", "UI", "API"];

export function turiaBridgeMode(env: Env = process.env): TuriaMode {
  const raw = (env.FIRM_OS_TURIA_BRIDGE ?? "").trim().toUpperCase();
  if (!raw) return "MANUAL";
  if ((MODES as readonly string[]).includes(raw)) return raw as TuriaMode;
  throw new Error(`FIRM_OS_TURIA_BRIDGE must be one of ${MODES.join(", ")} (got "${env.FIRM_OS_TURIA_BRIDGE}")`);
}

export interface TuriaFactoryOptions {
  env?: Env;
  repo: TuriaSyncRepo;
  actorIsPartner?: boolean;
  now?: () => Date;
}

export function createTuriaAdapter(opts: TuriaFactoryOptions): TuriaAdapter {
  const mode = turiaBridgeMode(opts.env);
  if (mode === "UI") return new UiAutomationBridge({ env: opts.env, actorIsPartner: opts.actorIsPartner });
  if (mode === "API") return new ApiBridge();
  return new ManualBridge(opts.repo, opts.now);
}

/** The manual bridge, for confirmations: confirming a checklist works whatever bridge is active now. */
export function manualBridge(repo: TuriaSyncRepo, now?: () => Date): ManualBridge {
  return new ManualBridge(repo, now);
}

// Typed failures for the Turia bridges. TuriaBlockedError extends the Path A BlockedError so a
// caller (the onboarding saga) can treat "a human must do X first" the same way for SharePoint
// and Turia: record the exact action, never fail-and-forget.
import { BlockedError } from "../sharepoint/errors";

export class TuriaBlockedError extends BlockedError {
  constructor(action: string) {
    super(action, `BLOCKED (Turia): ${action}`);
    this.name = "TuriaBlockedError";
  }
}

/** A confirmation that does not fit the sync row (unknown id, different ref, missing minutes). */
export class TuriaConfirmError extends Error {
  readonly code: "not-found" | "invalid" | "conflict";
  constructor(code: "not-found" | "invalid" | "conflict", message: string) {
    super(message);
    this.name = "TuriaConfirmError";
    this.code = code;
  }
}

// plain-messages: for IT — the bridge setting by name. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
export const NO_TURIA_API_ACTION =
  "Turia has no documented API (ADR-003). Ask Turia (vendor) for API documentation and credentials; until then keep FIRM_OS_TURIA_BRIDGE=MANUAL.";

// plain-messages: for IT — the bridge settings by name. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
export const UI_BRIDGE_DISABLED_ACTION =
  "UI automation against practice.turia.in is off. Keep FIRM_OS_TURIA_BRIDGE=MANUAL, or — only after Turia confirms UI automation is permitted under the firm's subscription — set FIRM_OS_TURIA_UI=true.";

// plain-messages: for IT — the bridge setting by name. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
export const UI_BRIDGE_NOT_BUILT_ACTION =
  "UiAutomationBridge is a stub: automation is not implemented yet. Set FIRM_OS_TURIA_BRIDGE=MANUAL and complete the Turia checklist by hand.";

export const UI_BRIDGE_PARTNER_ONLY_ACTION = "Turia UI automation runs only for a partner. Ask a partner to run this step, or use the manual checklist.";

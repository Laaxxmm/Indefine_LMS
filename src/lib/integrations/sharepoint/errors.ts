// Typed failures for the SharePoint Path A integration.

/**
 * A precondition only a human can satisfy (a missing secret, certificate or admin consent).
 * `action` is the exact step to take; callers surface it verbatim (PROGRESS "Blocked", CLI output).
 */
export class BlockedError extends Error {
  readonly action: string;
  constructor(action: string, message = `BLOCKED: ${action}`) {
    super(message);
    this.name = "BlockedError";
    this.action = action;
  }
}

/** A non-success HTTP response from Graph or SharePoint REST after retries. */
export class GraphError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  constructor(status: number, method: string, url: string, body: string) {
    super(`${method} ${url} failed: ${status} ${body.slice(0, 300)}`);
    this.name = "GraphError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** The site or library an operation needs does not exist yet (run the matching ensure-* first). */
export class NotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotProvisionedError";
  }
}

export const GRAPH_BLOCKED_ACTION =
  "Set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (the LMS app-only Graph app) in .env.local (dev) / Railway variables (prod), " +
  "and grant that app Microsoft Graph application permissions Sites.ReadWrite.All and Group.Read.All with tenant admin consent.";

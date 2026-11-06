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

/**
 * A request the client refused to send because its address is not where the credential belongs
 * (a Graph token to a non-Graph host, a SharePoint token to another host, an upload URL off
 * Microsoft's hosts). Only the host is named: the full URL may carry a credential.
 */
export class UnsafeUrlError extends Error {
  readonly host: string;
  constructor(host: string, what: string) {
    super(`Refused to send ${what} to ${host || "an invalid address"}: it is not a Microsoft Graph or SharePoint address for this tenant.`);
    this.name = "UnsafeUrlError";
    this.host = host;
  }
}

/** The site or library an operation needs does not exist yet (run the matching ensure-* first). */
export class NotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotProvisionedError";
  }
}

// plain-messages: for IT — the server settings and permissions by name, for verify:patha and the logs. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
export const GRAPH_BLOCKED_ACTION =
  "Set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (the LMS app-only Graph app) in .env.local (dev) / Railway variables (prod), " +
  "and grant that app Microsoft Graph application permissions Sites.ReadWrite.All and Group.Read.All with tenant admin consent.";

/**
 * A file already exists where an upload was asked to create one. Uploads always use
 * conflictBehavior "fail", so nothing is ever overwritten; the caller picks a new name
 * (deliverable-store.ts bumps the `_v{n}` suffix).
 */
export class ConflictError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`A file already exists at ${path}; uploads never overwrite`);
    this.name = "ConflictError";
    this.path = path;
  }
}

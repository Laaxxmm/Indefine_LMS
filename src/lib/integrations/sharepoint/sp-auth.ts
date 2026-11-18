// SharePoint-resource tokens for the PnP app via certificate (client assertion) auth.
// SharePoint REST rejects client-secret app-only tokens, so site creation, hub join and
// site groups need this flow. Implemented with node:crypto only (RFC 7523 JWT bearer).
import { X509Certificate, createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import type { PnpCredentials } from "./config";
import { GraphError } from "./errors";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const b64url = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const b64urlJson = (o: object) => b64url(Buffer.from(JSON.stringify(o)));

/** x5t (SHA-1) and, when the certificate is available, x5t#S256 header values. */
export function certThumbprints(creds: Pick<PnpCredentials, "certPem" | "thumbprint">): { x5t: string; x5tS256?: string } {
  if (creds.certPem) {
    const der = new X509Certificate(creds.certPem).raw;
    return {
      x5t: b64url(createHash("sha1").update(der).digest()),
      x5tS256: b64url(createHash("sha256").update(der).digest()),
    };
  }
  if (!creds.thumbprint || !/^[0-9A-Fa-f]{40}$/.test(creds.thumbprint)) {
    throw new Error("PnP certificate thumbprint must be 40 hex characters (SHA-1)");
  }
  return { x5t: b64url(Buffer.from(creds.thumbprint, "hex")) };
}

export function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

/** Signed RS256 client assertion for the Entra v2 token endpoint. Valid for 10 minutes. */
export function buildClientAssertion(creds: PnpCredentials, opts: { nowSec?: number; jti?: string } = {}): string {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const { x5t, x5tS256 } = certThumbprints(creds);
  const header = { alg: "RS256", typ: "JWT", x5t, ...(x5tS256 ? { "x5t#S256": x5tS256 } : {}) };
  const payload = {
    aud: tokenEndpoint(creds.tenantId),
    iss: creds.clientId,
    sub: creds.clientId,
    jti: opts.jti ?? randomUUID(),
    nbf: now,
    iat: now,
    exp: now + 600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = createPrivateKey(creds.passphrase ? { key: creds.privateKeyPem, passphrase: creds.passphrase } : creds.privateKeyPem);
  return `${signingInput}.${b64url(sign("RSA-SHA256", Buffer.from(signingInput), key))}`;
}

/** Returns `(host) => token` for resource https://{host}, caching each token until 60 s before expiry. */
export function createPnpTokenProvider(
  creds: PnpCredentials,
  deps: { fetch?: FetchLike; now?: () => number } = {},
): (host: string) => Promise<string> {
  const doFetch: FetchLike = deps.fetch ?? ((u, i) => fetch(u, i));
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { token: string; exp: number }>();
  return async (host: string) => {
    const hit = cache.get(host);
    if (hit && hit.exp > now() + 60_000) return hit.token;
    const url = tokenEndpoint(creds.tenantId);
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        scope: `https://${host}/.default`,
        grant_type: "client_credentials",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: buildClientAssertion(creds, { nowSec: Math.floor(now() / 1000) }),
      }).toString(),
    });
    if (!res.ok) throw new GraphError(res.status, "POST", url, await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cache.set(host, { token: json.access_token, exp: now() + json.expires_in * 1000 });
    return json.access_token;
  };
}

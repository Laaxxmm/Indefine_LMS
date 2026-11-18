// SharePoint Path A configuration, read from env in one place (docs/folder-contract.md §6).
import { BlockedError } from "./errors";
import { DEFAULT_TENANT_HOST, hubSiteUrl } from "./paths";

export const PNP_CLIENT_ID_DEFAULT = "381abf0e-e427-417f-9b45-651e8ca823ec";

export interface PnpCredentials {
  tenantId: string;
  clientId: string;
  privateKeyPem: string;
  certPem: string | null;
  /** SHA-1 thumbprint, hex, used when certPem is absent. */
  thumbprint: string | null;
  passphrase: string | null;
}

export interface SharePointConfig {
  tenantHost: string;
  hubSiteUrl: string;
  tenantId: string;
  /** UPN made owner of new CL- sites (required by SPSiteManager/create with app-only tokens). */
  siteOwner: string | null;
  /** Null when the certificate is not configured; see pnpMissing. */
  pnp: PnpCredentials | null;
  pnpMissing: string[];
}

type Env = Record<string, string | undefined>;

const val = (env: Env, k: string) => {
  const v = env[k]?.trim();
  return v ? v : null;
};
/** Env values often carry PEMs on one line with literal "\n". */
const pem = (v: string | null) => (v ? v.replace(/\\n/g, "\n") : null);

export function readSharePointConfig(env: Env = process.env): SharePointConfig {
  const tenantHost = val(env, "SP_TENANT_HOST") ?? DEFAULT_TENANT_HOST;
  const tenantId = val(env, "SP_TENANT_ID") ?? val(env, "MS_TENANT_ID") ?? `${tenantHost.split(".")[0]}.onmicrosoft.com`;
  const privateKeyPem = pem(val(env, "SP_PNP_CERT_KEY_PEM"));
  const certPem = pem(val(env, "SP_PNP_CERT_PEM"));
  const thumbprint = val(env, "SP_PNP_CERT_THUMBPRINT")?.replace(/[^0-9a-fA-F]/g, "").toUpperCase() || null;
  const pnpMissing: string[] = [];
  if (!privateKeyPem) pnpMissing.push("SP_PNP_CERT_KEY_PEM");
  if (!certPem && !thumbprint) pnpMissing.push("SP_PNP_CERT_PEM or SP_PNP_CERT_THUMBPRINT");
  return {
    tenantHost,
    hubSiteUrl: val(env, "SP_HUB_SITE_URL") ?? hubSiteUrl(tenantHost),
    tenantId,
    siteOwner: val(env, "SP_SITE_OWNER"),
    pnp:
      privateKeyPem && pnpMissing.length === 0
        ? {
            tenantId,
            clientId: val(env, "SP_PNP_CLIENT_ID") ?? PNP_CLIENT_ID_DEFAULT,
            privateKeyPem,
            certPem,
            thumbprint,
            passphrase: val(env, "SP_PNP_CERT_KEY_PASSPHRASE"),
          }
        : null,
    pnpMissing,
  };
}

export function pnpBlockedAction(missing: string[], clientId = PNP_CLIENT_ID_DEFAULT): string {
  return (
    `Upload a certificate (.cer, public part) to the Entra app registration "PnP" (ClientId ${clientId}) under Certificates & secrets, ` +
    `confirm it has SharePoint application permission Sites.FullControl.All with tenant admin consent, ` +
    `then set ${missing.join(" and ")} in .env.local (dev) / Railway variables (prod).`
  );
}

// plain-messages: for IT — the server setting by name, for verify:patha and the logs. People see a plain sentence instead (src/lib/errors plainAction / userMessage).
export const SITE_OWNER_BLOCKED_ACTION =
  "Set SP_SITE_OWNER to the UPN of the account that should own new CL- sites (e.g. a partner or the SharePoint admin) in .env.local / Railway.";

/** The PnP credentials, or a BlockedError naming the exact human action. */
export function requirePnp(cfg: SharePointConfig): PnpCredentials {
  if (!cfg.pnp) throw new BlockedError(pnpBlockedAction(cfg.pnpMissing));
  return cfg.pnp;
}

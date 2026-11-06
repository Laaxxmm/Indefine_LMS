// Entra tenant pinning and e-mail normalisation for sign-in (security audit #31). Pure: no imports,
// so it is tested on its own and src/lib/auth.ts stays thin.
//
// Tenant: the app is single-tenant. AUTH_MICROSOFT_ENTRA_ID_ISSUER must be
//   https://login.microsoftonline.com/<tenant GUID>/v2.0
// — a multi-tenant issuer (/common, /organizations, /consumers, with or without a trailing path) or
// a domain-name tenant is refused (a domain issuer never matches Entra's GUID-form `iss` anyway).
// On top of the issuer check, every sign-in's id-token `tid` claim must equal that tenant GUID, so
// an account from another tenant is refused even if the issuer configuration is ever loosened.
//
// E-mail: Entra may return any capitalisation (John.Doe@Firm.in); the org sync stores lower case.
// Every comparison and every stored address goes through normalizeEmail() so one person never gets
// two User rows or is locked out by a case mismatch.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MULTI_TENANT = /^(common|organizations|consumers)$/i;
const ENTRA_HOST = "login.microsoftonline.com";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The tenant GUID the issuer pins (lower case), or null when the issuer is missing, multi-tenant, a domain name, or not Entra. */
export function tenantFromIssuer(issuer: string | null | undefined): string | null {
  if (!issuer?.trim()) return null;
  let u: URL;
  try {
    u = new URL(issuer.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== ENTRA_HOST || u.username || u.password || u.search || u.hash) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  const tenant = segments[0] ?? "";
  if (MULTI_TENANT.test(tenant) || !GUID.test(tenant)) return null;
  if (segments.length > 2 || (segments[1] !== undefined && segments[1] !== "v2.0")) return null;
  return tenant.toLowerCase();
}

/** True when the issuer pins exactly one tenant (see tenantFromIssuer). */
export const isTenantPinned = (issuer: string | null | undefined) => tenantFromIssuer(issuer) !== null;

export type TenantCheck = { ok: true; tenant: string } | { ok: false; reason: string };

/** Sign-in gate: the issuer pins a tenant AND the id token's `tid` claim is that tenant. */
export function checkTenant(issuer: string | null | undefined, tid: unknown): TenantCheck {
  const tenant = tenantFromIssuer(issuer);
  // plain-messages: for IT — the sign-in setting by name; written to the server log, never shown on a page.
  if (!tenant) return { ok: false, reason: "AUTH_MICROSOFT_ENTRA_ID_ISSUER must be https://login.microsoftonline.com/<tenant id>/v2.0 for the firm's tenant; sign-in refused" };
  if (typeof tid !== "string" || tid.toLowerCase() !== tenant) return { ok: false, reason: `the account's tenant (${typeof tid === "string" ? tid : "missing"}) is not the firm's tenant; sign-in refused` };
  return { ok: true, tenant };
}

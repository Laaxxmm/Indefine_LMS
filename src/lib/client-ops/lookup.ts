// Public metadata only — no accounts, no API keys, no credentials in this file.
import tls from "node:tls";
import { HostRefusedError, resolvePublicHost, type Lookup } from "@/lib/hardening/net";

const UA = "indefine-lms/1.0 (client-ops renewal tracker)";

export type LookupResult = { date: Date; note?: string } | { error: string };

/** Registry expiry for a domain, via the RDAP bootstrap at rdap.org. */
export async function rdapExpiry(domain: string): Promise<LookupResult> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json", "user-agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { error: "not in registry, or TLD has no RDAP service" };
    if (!res.ok) return { error: `RDAP responded ${res.status}` };
    const json = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const event = (json.events ?? []).find((e) => /expiration/i.test(e.eventAction ?? ""));
    if (!event?.eventDate) return { error: "RDAP record carries no expiry date" };
    return { date: new Date(event.eventDate) };
  } catch (e) {
    const err = e as Error;
    return { error: err.name === "TimeoutError" ? "RDAP timed out" : `RDAP failed: ${err.message}` };
  }
}

export type SslDeps = { lookup?: Lookup; connect?: typeof tls.connect };

/**
 * Certificate expiry for a host.
 * `rejectUnauthorized` is off deliberately: an expired or mismatched certificate is exactly
 * the case worth reporting, and a rejected handshake would hide the date we came for.
 * Nothing is sent over this socket — it reads the presented certificate and hangs up.
 *
 * The host is staff-typed, so it is checked first (security audit #23): a plain DNS name only
 * (no IP literal, port or path), resolved here, and refused if any address is loopback,
 * private, link-local / cloud metadata or otherwise reserved. The socket then goes to the
 * resolved address (SNI = the name), so a second DNS answer cannot redirect it.
 */
export async function sslExpiry(hostInput: string, deps: SslDeps = {}): Promise<LookupResult> {
  let target: { host: string; address: string };
  try {
    target = await resolvePublicHost(hostInput, deps.lookup);
  } catch (e) {
    if (e instanceof HostRefusedError) return { error: e.message };
    throw e;
  }
  const connect = deps.connect ?? tls.connect;
  return new Promise((resolve) => {
    const finish = (result: LookupResult) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    const socket = connect(
      { host: target.address, port: 443, servername: target.host, rejectUnauthorized: false, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate();
        const cn = cert?.subject?.CN;
        finish(
          cert?.valid_to
            ? { date: new Date(cert.valid_to), note: Array.isArray(cn) ? cn[0] : cn }
            : { error: "no certificate presented" },
        );
      },
    );
    socket.on("error", (e: NodeJS.ErrnoException) => finish({ error: `TLS failed: ${e.code ?? e.message}` }));
    socket.on("timeout", () => finish({ error: "TLS timed out" }));
  });
}

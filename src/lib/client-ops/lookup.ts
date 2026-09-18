// Public metadata only — no accounts, no API keys, no credentials in this file.
import tls from "node:tls";

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

/**
 * Certificate expiry for a host.
 * `rejectUnauthorized` is off deliberately: an expired or mismatched certificate is exactly
 * the case worth reporting, and a rejected handshake would hide the date we came for.
 * Nothing is sent over this socket — it reads the presented certificate and hangs up.
 */
export function sslExpiry(host: string): Promise<LookupResult> {
  return new Promise((resolve) => {
    const finish = (result: LookupResult) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 },
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

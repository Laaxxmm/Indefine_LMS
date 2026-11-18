// Outbound-request hygiene (security audit #23, #24, #33): which hosts and links the server may
// reach or render.
//
//   validateHostname(h)   a plain DNS name (no IP literal, no port, no path, no userinfo)
//   isPublicAddress(ip)   false for loopback, RFC 1918, CGNAT, link-local (incl. cloud metadata
//                         169.254.169.254 / fd00:ec2::254), unique-local, multicast, reserved, ...
//   resolvePublicHost(h)  validates, resolves DNS, and refuses when ANY address is not public;
//                         returns the address to connect to (so a later lookup cannot rebind it)
//   httpsLink(v)          the URL when its scheme is https:, else null (links shown to people)
//   isGraphUrl(v)         https://graph.microsoft.com/... only (before a Graph bearer is sent)
import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: AWS/Azure/GCP metadata 169.254.169.254
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments (Oracle metadata 192.0.0.192)
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (embeds IPv4)
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique-local (incl. fd00:ec2::254, AWS metadata over IPv6)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** IPv4-mapped / -compatible IPv6 (::ffff:10.0.0.1) → the IPv4 inside, else null. */
function embeddedIpv4(ip: string): string | null {
  const m = /^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** True only for a globally routable unicast address. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return false;
  if (v === 6) {
    const inner = embeddedIpv4(ip);
    if (inner) return isPublicAddress(inner);
    return !blocked.check(ip, "ipv6");
  }
  return !blocked.check(ip, "ipv4");
}

export class HostRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostRefusedError";
  }
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A plain public-looking DNS name, lower-cased and without a trailing dot; throws HostRefusedError otherwise. */
export function validateHostname(input: string): string {
  const host = (input ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) throw new HostRefusedError("Enter a host name such as www.example.in");
  if (isIP(host) || isIP(host.replace(/^\[|\]$/g, ""))) throw new HostRefusedError("Enter a host name, not an IP address");
  if (host === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) throw new HostRefusedError(`${host} is an internal name`);
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1])) {
    throw new HostRefusedError(`"${input}" is not a host name (letters, digits, hyphens and dots only, e.g. www.example.in)`);
  }
  return host;
}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/**
 * Validates `host`, resolves it, and refuses unless every address is public. Returns the host and
 * the first address: connect to that address (with `servername: host` for TLS) so a second DNS
 * answer cannot point the connection somewhere else.
 */
export async function resolvePublicHost(input: string, lookup: Lookup = systemLookup): Promise<{ host: string; address: string; family: number }> {
  const host = validateHostname(input);
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host);
  } catch (e) {
    throw new HostRefusedError(`${host} did not resolve (${(e as NodeJS.ErrnoException).code ?? "DNS error"})`);
  }
  if (!addrs.length) throw new HostRefusedError(`${host} did not resolve`);
  const bad = addrs.find((a) => !isPublicAddress(a.address));
  if (bad) throw new HostRefusedError(`${host} resolves to a private or reserved address, so it is not checked`);
  return { host, address: addrs[0].address, family: addrs[0].family };
}

/** The link when it is an absolute https: URL with no credentials; null for javascript:, data:, http:, relative, ... */
export function httpsLink(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const GRAPH_HOST = "graph.microsoft.com";

/** Only https://graph.microsoft.com URLs may carry the Graph bearer token (e.g. an @odata.nextLink). */
export function isGraphUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.host === GRAPH_HOST && !u.username && !u.password;
  } catch {
    return false;
  }
}

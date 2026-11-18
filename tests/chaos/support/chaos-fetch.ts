// Fault injection around a fetch-compatible transport (FakeSharePoint.fetch, a Grok fetch).
// Each rule picks requests by method + URL and scripts what the caller sees, in order:
//
//   respond        the request never reached the service; the caller gets this status
//                  (429 throttling with Retry-After, 503 outage, …)
//   lose-response  the request WAS applied by the service, but the 2xx never arrived; the caller
//                  sees `status` instead (the classic "did my write land?" case)
//   network        the connection failed before any response (fetch throws TypeError)
//
// Requests that no rule faults go to the inner transport unchanged. Nothing here touches the
// network; it only wraps an in-memory fake.
import type { FetchLike } from "@/lib/integrations/sharepoint/graph-client";

export type Fault =
  | { kind: "respond"; status: number; headers?: Record<string, string>; body?: string }
  | { kind: "lose-response"; status: number }
  | { kind: "network" };

export interface FaultRule {
  /** Which requests this rule may fault. */
  match: (method: string, url: string) => boolean;
  /** Faults served in order to the matching requests; when empty the rule stops faulting. */
  faults: Fault[];
  /** Matching requests to let through untouched before the first fault (default 0). */
  skip?: number;
}

export interface FaultLogEntry {
  method: string;
  url: string;
  fault: Fault["kind"] | null;
}

export const respond = (status: number, headers: Record<string, string> = {}, body?: string): Fault => ({ kind: "respond", status, headers, body });
export const loseResponse = (status = 503): Fault => ({ kind: "lose-response", status });
export const networkDown = (): Fault => ({ kind: "network" });
export const times = (n: number, fault: Fault): Fault[] => Array.from({ length: n }, () => fault);

/** Wraps `inner`; returns the faulting transport and a log of every request it saw. */
export function chaosFetch(inner: FetchLike, rules: FaultRule[]) {
  const log: FaultLogEntry[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    let fault: Fault | undefined;
    for (const rule of rules) {
      if (!rule.match(method, url) || rule.faults.length === 0) continue;
      if ((rule.skip ?? 0) > 0) {
        rule.skip = (rule.skip ?? 0) - 1;
        continue;
      }
      fault = rule.faults.shift();
      break;
    }
    log.push({ method, url, fault: fault?.kind ?? null });
    if (!fault) return inner(url, init);
    if (fault.kind === "network") throw new TypeError("fetch failed (chaos: connection reset)");
    if (fault.kind === "lose-response") {
      await inner(url, init); // the service applied it…
      return new Response(JSON.stringify({ error: { code: "serviceNotAvailable" } }), { status: fault.status, headers: { "Content-Type": "application/json" } }); // …the caller never hears
    }
    return new Response(fault.body ?? JSON.stringify({ error: { code: fault.status === 429 ? "activityLimitReached" : "serviceNotAvailable" } }), {
      status: fault.status,
      headers: { "Content-Type": "application/json", ...fault.headers },
    });
  };
  return { fetch, log, faulted: () => log.filter((l) => l.fault !== null) };
}

/** Request matchers. */
export const is = {
  folderCreate: (m: string, u: string) => m === "POST" && /\/children$/.test(u.split("?")[0]),
  listCreate: (m: string, u: string) => m === "POST" && /\/sites\/[^/]+\/lists$/.test(u.split("?")[0]),
  graphRead: (m: string, u: string) => m === "GET" && u.startsWith("https://graph.microsoft.com/"),
  upload: (m: string) => m === "PUT",
  any: () => true,
};

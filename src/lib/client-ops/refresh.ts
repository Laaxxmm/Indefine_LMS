import { prisma } from "@/lib/prisma";
import { rdapExpiry, sslExpiry } from "./lookup";
import { shortDate } from "./core";

export type RefreshSummary = { checked: number; moved: number; failed: number; at: Date };

/**
 * Refresh expiry facts from public sources: the registry (RDAP) for domains, a TLS
 * handshake for certificates. No provider accounts, no API keys.
 *
 * The registry date IS the domain renewal deadline, so it overwrites `expiresOn` and the
 * previous value is kept in the note. A certificate rides its own ~90-day cycle and stays
 * in `sslExpiresOn`, never written over the billing date.
 *
 * One implementation behind both callers: the dashboard button and the nightly cron.
 */
export async function runChecks(): Promise<RefreshSummary> {
  const rows = await prisma.opsSubscription.findMany({
    where: { active: true, OR: [{ domain: { not: null } }, { sslHost: { not: null } }] },
    select: { id: true, expiresOn: true, domain: true, sslHost: true, sslExpiresOn: true },
  });

  const results = await Promise.all(
    rows.map(async (r) => {
      const [registry, cert] = await Promise.all([
        r.domain ? rdapExpiry(r.domain) : null,
        r.sslHost ? sslExpiry(r.sslHost) : null,
      ]);

      const notes: string[] = [];
      let expiresOn = r.expiresOn;
      let moved = false;

      if (registry && "date" in registry) {
        moved = registry.date.toDateString() !== r.expiresOn.toDateString();
        notes.push(
          moved
            ? `registry says ${shortDate(registry.date)} (was ${shortDate(r.expiresOn)})`
            : `registry confirms ${shortDate(registry.date)}`,
        );
        expiresOn = registry.date;
      } else if (registry) {
        notes.push(`registry: ${registry.error}`);
      }

      if (cert && "date" in cert) notes.push(`cert valid to ${shortDate(cert.date)}`);
      else if (cert) notes.push(`cert: ${cert.error}`);

      // A failed probe keeps the last known certificate date rather than blanking it.
      const sslExpiresOn = cert && "date" in cert ? cert.date : r.sslExpiresOn;
      const failed = Boolean((registry && "error" in registry) || (cert && "error" in cert));

      return { id: r.id, expiresOn, sslExpiresOn, note: notes.join(" · ") || null, moved, failed };
    }),
  );

  const at = new Date();
  await prisma.$transaction(
    results.map((r) =>
      prisma.opsSubscription.update({
        where: { id: r.id },
        data: { expiresOn: r.expiresOn, sslExpiresOn: r.sslExpiresOn, checkedAt: at, checkNote: r.note },
      }),
    ),
  );

  return {
    checked: results.length,
    moved: results.filter((r) => r.moved).length,
    failed: results.filter((r) => r.failed).length,
    at,
  };
}

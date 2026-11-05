// Path A gap check — READ-ONLY. Prints a markdown gap table (hub, Entra groups, every
// CL-{Code} site: hub join, Compliance library, FY tree, ClientObligations/ClientRequests
// lists, Client Upload group) and exits 0 (no gaps), 1 (gaps) or 2 (blocked/error).
// It only calls get/list operations; gaps are fixed with the idempotent ensure-* functions
// (docs/folder-contract.md §3), never from here.
//
//   npx tsx --env-file=.env.local scripts/verify-patha.ts [--codes ACME,FOO] [--fy 2026-27] [--out gaps.md]
// Needs MS_* (Graph app-only) and, for hub/site-group rows, the PnP certificate (SP_PNP_*).
import { writeFileSync } from "node:fs";
import { readSharePointConfig } from "../src/lib/integrations/sharepoint/config";
import { defaultSharePointClient } from "../src/lib/integrations/sharepoint/factory";
import {
  discoverClientCodes, exitCodeFor, formatGapTable, parsePathAArgs, preflightBlocked, runPathACheck,
} from "../src/lib/integrations/sharepoint/patha-check";
import { fyLabel, normalizeFy } from "../src/lib/integrations/sharepoint/paths";
import { formatIst } from "../src/lib/ist";

async function firmClientCodes(): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { prisma } = await import("../src/lib/prisma");
    const rows = await prisma.firmClient.findMany({ select: { clientCode: true } });
    await prisma.$disconnect();
    return rows.map((r) => r.clientCode);
  } catch (e) {
    console.error(`(FirmClient codes unavailable: ${(e as Error).message.split("\n")[0]})`);
    return [];
  }
}

async function main(): Promise<number> {
  const args = parsePathAArgs(process.argv.slice(2));
  if (args.help) {
    console.log("npx tsx scripts/verify-patha.ts [--codes ACME,FOO] [--fy 2026-27] [--out gaps.md]");
    return 0;
  }
  const config = readSharePointConfig();
  const fys = args.fys.length ? args.fys.map((f) => normalizeFy(f)) : [fyLabel(new Date())];
  const emit = (text: string) => {
    process.stdout.write(text);
    if (args.out) writeFileSync(args.out, text);
  };

  const blocked = preflightBlocked(process.env, config);
  if (blocked.length) {
    emit(`${blocked.map((a) => `BLOCKED: ${a}`).join("\n")}\n`);
    return 2;
  }

  const client = defaultSharePointClient(config);
  const codes = new Set(args.codes ?? []);
  if (!args.codes) {
    for (const c of discoverClientCodes(await client.searchSites("CL-"), config.tenantHost)) codes.add(c);
    for (const c of await firmClientCodes()) codes.add(c);
  }
  const rows = await runPathACheck({ client, config, codes: [...codes].sort(), fys });
  emit(formatGapTable(rows, { generatedAt: formatIst(new Date()), fys }));
  return exitCodeFor(rows);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`verify-patha failed: ${(e as Error).message}`);
    process.exit(2);
  },
);

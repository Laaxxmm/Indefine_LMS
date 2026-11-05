// DRY RUN ONLY. Proposes where each legacy /clients folder would live under Path A
// (docs/folder-contract.md §4) and prints the mapping as markdown (default) or CSV.
// Reads the database (clients, jobs, FirmClient codes) and lists GRAPH_CLIENTS_ROOT through
// Graph to flag missing legacy folders. It never writes to Graph or the database and never
// moves or copies a file; the legacy layout stays readable.
//
//   npx tsx --env-file=.env.local scripts/map-legacy-folders.ts [--format md|csv] [--out mapping.md]
import { writeFileSync } from "node:fs";
import { clientsRoot } from "../src/lib/clients/storage";
import { readSharePointConfig } from "../src/lib/integrations/sharepoint/config";
import { BlockedError } from "../src/lib/integrations/sharepoint/errors";
import { defaultSharePointClient } from "../src/lib/integrations/sharepoint/factory";
import { mapLegacyFolders, mappingToCsv, mappingToMarkdown, type LegacyClient } from "../src/lib/integrations/sharepoint/legacy-map";
import { formatIst } from "../src/lib/ist";

function parseArgs(argv: string[]): { format: "md" | "csv"; out: string | null } {
  const a = { format: "md" as "md" | "csv", out: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--format") {
      const f = argv[++i];
      if (f !== "md" && f !== "csv") throw new Error(`--format must be md or csv, got "${f}"`);
      a.format = f;
    } else if (argv[i] === "--out") a.out = argv[++i] ?? null;
    else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  return a;
}

/** Names of legacy client folders, or null when Graph cannot be read (report says so). */
async function legacyFolderNames(root: string): Promise<{ names: Set<string> | null; note: string }> {
  const driveId = process.env.GRAPH_DRIVE_ID;
  if (!driveId) return { names: null, note: "GRAPH_DRIVE_ID not set: legacy folder existence not checked" };
  try {
    const client = defaultSharePointClient(readSharePointConfig());
    const items = await client.listChildren(driveId, root);
    return { names: new Set(items.filter((i) => i.folder).map((i) => i.name)), note: "" };
  } catch (e) {
    const why = e instanceof BlockedError ? e.action : (e as Error).message.split("\n")[0];
    return { names: null, note: `legacy folder existence not checked: ${why}` };
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.log("BLOCKED: set DATABASE_URL (staging or a read replica of the LMS database) in .env.local to read clients and FirmClient codes.");
    return 2;
  }
  const { prisma } = await import("../src/lib/prisma");
  try {
    const rows = await prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        folderName: true,
        onboardedOn: true,
        firmClient: { select: { clientCode: true } },
        jobs: { orderBy: [{ fy: "asc" }], select: { id: true, fy: true, serviceType: { select: { name: true, department: true } } } },
      },
    });
    const root = clientsRoot();
    const legacy = await legacyFolderNames(root);
    const clients: LegacyClient[] = rows.map((c) => ({
      clientId: c.id,
      clientName: c.name,
      folderName: c.folderName,
      clientCode: c.firmClient?.clientCode ?? null,
      onboardedOn: c.onboardedOn,
      jobs: c.jobs.map((j) => ({ jobId: j.id, fy: j.fy, department: j.serviceType.department, serviceName: j.serviceType.name })),
      legacyFolderExists: legacy.names ? legacy.names.has(c.folderName) : null,
    }));
    const mapping = mapLegacyFolders(clients, { legacyRoot: root, host: readSharePointConfig().tenantHost });
    let text = args.format === "csv" ? mappingToCsv(mapping) : mappingToMarkdown(mapping, { generatedAt: formatIst(new Date()) });
    if (legacy.note && args.format === "md") text += `\n> ${legacy.note}\n`;
    else if (legacy.note) console.error(legacy.note);
    process.stdout.write(text);
    if (args.out) writeFileSync(args.out, text);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`map-legacy-folders failed: ${(e as Error).message}`);
    process.exit(2);
  },
);

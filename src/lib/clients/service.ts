// Client record creation, shared by POST /api/clients (the /clients/new form) and the Firm OS
// onboarding saga (src/lib/agents/onboarding). Takes a Prisma client or a transaction so a caller
// can create the client together with its own rows atomically. No SharePoint here: the route
// creates legacy folders afterwards; Firm OS provisions Path A instead. Never deletes.
import { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { folderName, turnoverBand, type ClientBody, type JobBody } from "./core";

export type ClientDb = { client: Pick<typeof prisma.client, "findFirst" | "create"> };

export class ClientNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientNameError";
  }
}

export class ClientExistsError extends Error {
  constructor(public readonly existingId: string | null, public readonly existingName: string | null) {
    super(existingName ? `Client already exists: ${existingName}` : "Client already exists");
    this.name = "ClientExistsError";
  }
}

/** The SharePoint-safe folder name for a client, or ClientNameError when it cannot be one. */
export function clientFolderName(name: string): string {
  const fname = folderName(name);
  if (!/[A-Za-z0-9]/.test(fname)) throw new ClientNameError("Client name needs at least one letter or digit");
  if (fname.toLowerCase() === "_database") throw new ClientNameError("That name is reserved");
  return fname;
}

/** An existing client with the same name, folder name or PAN (case-insensitive), or null. */
export async function findDuplicateClient(db: ClientDb, q: { name: string; pan?: string | null }): Promise<{ id: string; name: string } | null> {
  const fname = folderName(q.name);
  return db.client.findFirst({
    where: {
      OR: [
        { name: { equals: q.name, mode: "insensitive" } },
        { folderName: { equals: fname, mode: "insensitive" } },
        ...(q.pan ? [{ pan: q.pan }] : []),
      ],
    },
    select: { id: true, name: true },
  });
}

/**
 * Create the Client row (and optionally its first Job) from a validated body (clientBodyZ).
 * Throws ClientNameError, or ClientExistsError on a duplicate (checked first, and again via the
 * unique constraints so a race cannot create two).
 */
export async function createClientRecord(
  db: ClientDb,
  input: { client: ClientBody; createdById: string; job?: JobBody },
): Promise<{ id: string; jobId: string | null }> {
  const fname = clientFolderName(input.client.name);
  const dup = await findDuplicateClient(db, { name: input.client.name, pan: input.client.pan });
  if (dup) throw new ClientExistsError(dup.id, dup.name);
  try {
    const created = await db.client.create({
      data: {
        ...input.client,
        folderName: fname,
        turnoverBand: turnoverBand(input.client.turnover),
        createdById: input.createdById,
        ...(input.job ? { jobs: { create: { ...input.job, createdById: input.createdById } } } : {}),
      },
      include: { jobs: { select: { id: true } } },
    });
    return { id: created.id, jobId: created.jobs[0]?.id ?? null };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ClientExistsError(null, null);
    throw e;
  }
}

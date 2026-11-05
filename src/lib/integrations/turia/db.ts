// Prisma-backed TuriaSyncRepo. Append/update only: nothing here removes a TuriaSync row.
import type { Prisma, PrismaClient, TuriaSync } from "@prisma/client";
import type { TuriaMode, TuriaOperation } from "./adapter";
import type { NewTuriaSync, TuriaEvidence, TuriaSyncPatch, TuriaSyncRecord, TuriaSyncRepo } from "./manual-bridge";

type Db = Pick<PrismaClient, "turiaSync">;

export function toRecord(row: TuriaSync): TuriaSyncRecord {
  return {
    id: row.id,
    jobTaskId: row.jobTaskId,
    firmClientId: row.firmClientId,
    operation: row.operation as TuriaOperation,
    mode: row.mode as TuriaMode,
    status: row.status,
    turiaRef: row.turiaRef,
    minutesLogged: row.minutesLogged,
    evidence: (row.evidence ?? null) as TuriaEvidence | null,
    confirmedById: row.confirmedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const json = (e: TuriaEvidence) => e as unknown as Prisma.InputJsonValue;

export function prismaTuriaSyncRepo(db: Db): TuriaSyncRepo {
  return {
    async findByKey(key) {
      const row = await db.turiaSync.findFirst({ where: { evidence: { path: ["key"], equals: key } }, orderBy: { createdAt: "desc" } });
      return row ? toRecord(row) : null;
    },
    async create(row: NewTuriaSync) {
      return toRecord(await db.turiaSync.create({ data: { ...row, evidence: json(row.evidence) } }));
    },
    async get(id) {
      const row = await db.turiaSync.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },
    async update(id, patch: TuriaSyncPatch) {
      return toRecord(await db.turiaSync.update({ where: { id }, data: { ...patch, evidence: json(patch.evidence) } }));
    },
  };
}

/** Every Turia sync recorded for a client (onboarding progress, close loop). */
export async function listTuriaSyncs(db: Db, firmClientId: string): Promise<TuriaSyncRecord[]> {
  const rows = await db.turiaSync.findMany({ where: { firmClientId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRecord);
}

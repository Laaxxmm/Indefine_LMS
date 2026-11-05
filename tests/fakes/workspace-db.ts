// In-memory stand-in for the tables /admin/firm-os/workspace reads and writes: User,
// WorkspaceSetting, RoleWorkspaceDefault, AuditEvent. Implements only the Prisma calls
// src/lib/workspace/admin.ts and settings.ts make. There is no way to remove a row.
import { Prisma } from "@prisma/client";

type Row = Record<string, unknown>;
export type WorkspaceTables = { users: Row[]; settings: Row[]; roles: Row[]; audit: Row[] };

const stored = (v: unknown) => (v === Prisma.DbNull || v === Prisma.JsonNull ? null : structuredClone(v));
const pick = (row: Row | undefined, select?: Record<string, boolean>) => {
  if (!row) return null;
  if (!select) return structuredClone(row);
  return Object.fromEntries(Object.keys(select).map((k) => [k, structuredClone(row[k])]));
};
const contains = (v: unknown, term: string) => typeof v === "string" && v.toLowerCase().includes(term.toLowerCase());

export const staffUsers: Row[] = [
  { id: "u-priya", name: "Priya S", email: "priya@indefine.test", role: "EMPLOYEE", level: "EXECUTIVE", department: "GST", active: true },
  { id: "u-meera", name: "Meera K", email: "meera@indefine.test", role: "EMPLOYEE", level: "MANAGER", department: "GST", active: true },
  { id: "u-anand", name: "Anand R", email: "anand@indefine.test", role: "EMPLOYEE", level: "PARTNER", department: "GENERAL", active: true },
  { id: "u-admin", name: "Asha Admin", email: "asha@indefine.test", role: "ADMIN", level: "EXECUTIVE", department: "GENERAL", active: true },
  { id: "u-old", name: "Old Hand", email: "old@indefine.test", role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: false },
];

export function createWorkspaceDb(seed: Partial<WorkspaceTables> = {}, now: () => Date = () => new Date("2026-11-05T06:30:00.000Z")) {
  const t: WorkspaceTables = { users: structuredClone(seed.users ?? staffUsers), settings: structuredClone(seed.settings ?? []), roles: structuredClone(seed.roles ?? []), audit: [] };
  let seq = 0;
  const upsert = (rows: Row[], key: string) => async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
    const found = rows.find((r) => r[key] === where[key]);
    const apply = (target: Row, data: Row) => {
      for (const [k, v] of Object.entries(data)) target[k] = stored(v);
      target.updatedAt = now();
      return target;
    };
    if (found) return structuredClone(apply(found, update));
    const row = apply({}, create);
    rows.push(row);
    return structuredClone(row);
  };
  const db = {
    user: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => pick(t.users.find((u) => u.id === where.id), select),
      findMany: async ({ where, take, select }: { where?: { id?: { in: string[] }; OR?: { name?: { contains: string }; email?: { contains: string } }[] }; take?: number; select?: Record<string, boolean> }) => {
        let rows = t.users;
        if (where?.id) rows = rows.filter((u) => where.id!.in.includes(u.id as string));
        if (where?.OR) rows = rows.filter((u) => where.OR!.some((c) => (c.name && contains(u.name, c.name.contains)) || (c.email && contains(u.email, c.email.contains))));
        rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return rows.slice(0, take ?? rows.length).map((r) => pick(r, select));
      },
    },
    workspaceSetting: {
      findUnique: async ({ where, select }: { where: { userId: string }; select?: Record<string, boolean> }) => pick(t.settings.find((s) => s.userId === where.userId), select),
      findMany: async ({ where, take, select }: { where?: { userId?: { in: string[] } }; take?: number; select?: Record<string, boolean> } = {}) => {
        let rows = t.settings;
        if (where?.userId) rows = rows.filter((s) => where.userId!.in.includes(s.userId as string));
        return rows.slice(0, take ?? rows.length).map((r) => pick(r, select));
      },
      upsert: upsert(t.settings, "userId"),
    },
    roleWorkspaceDefault: {
      findUnique: async ({ where, select }: { where: { role: string }; select?: Record<string, boolean> }) => pick(t.roles.find((r) => r.role === where.role), select),
      findMany: async ({ select }: { select?: Record<string, boolean> } = {}) => t.roles.map((r) => pick(r, select)),
      upsert: upsert(t.roles, "role"),
    },
    auditEvent: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `ae-${++seq}`, createdAt: now(), ...structuredClone(data) };
        t.audit.push(row);
        return row;
      },
    },
    $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])),
  };
  return { t, db };
}

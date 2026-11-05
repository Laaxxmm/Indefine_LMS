// Companion pairing tokens: create, list, revoke, verify. Only the sha256 of a token is stored
// (CompanionToken.tokenHash); the token itself is shown to its owner once and never again.
//
//   token     "fosc_" + 32 random bytes, base64url (43 chars)
//   stored    sha256(token) as hex, unique; label; createdAt; lastUsedAt; revokedAt
//   expiry    createdAt + COMPANION_TOKEN_TTL_DAYS (data in config.ts, no column)
//   revoke    UPDATE revokedAt — a pairing row is never removed (README: never delete user data)
//   verify    look up by hash, then a constant-time compare of the stored and computed hashes;
//             revoked or expired → refused; every accepted use updates lastUsedAt
//
// Every create and revoke writes an AuditEvent directly (entity CompanionToken). The audit meta
// carries the label and expiry only — never the token or its hash.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { formatDate, formatDateTimeIst } from "@/lib/agents/core/format";
import { DAY_MS } from "@/lib/ist";
import { hasCompanionAccess, type CompanionAccessDb, type CompanionUser } from "./access";
import { COMPANION_LABEL_MAX, COMPANION_MAX_ACTIVE_TOKENS, COMPANION_TOKEN_BYTES, COMPANION_TOKEN_PREFIX, COMPANION_TOKEN_TTL_DAYS } from "./config";
import { CompanionError } from "./errors";
import { MSG } from "./messages";

export type CompanionTokenDb = Pick<PrismaClient, "companionToken" | "auditEvent" | "$transaction"> & CompanionAccessDb;
type TokenOnlyDb = Pick<PrismaClient, "companionToken">;

const TOKEN_RE = new RegExp(`^${COMPANION_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);
const HASH_RE = /^[0-9a-f]{64}$/;

// ------------------------------------------------------------------ pure

/** A new random token. `rand` is injectable for tests only. */
export function generateToken(rand: (n: number) => Buffer = randomBytes): string {
  const bytes = rand(COMPANION_TOKEN_BYTES);
  if (bytes.length !== COMPANION_TOKEN_BYTES) throw new Error("token source returned the wrong number of bytes");
  return COMPANION_TOKEN_PREFIX + bytes.toString("base64url");
}

/** Could this string be a companion token? (Checked before any database work.) */
export function isTokenShape(raw: string): boolean {
  return TOKEN_RE.test(raw);
}

/** sha256 of the token, lowercase hex — the only form ever stored. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time comparison of two sha256 hex digests (false for anything that is not one). */
export function hashesEqual(a: string, b: string): boolean {
  if (!HASH_RE.test(a) || !HASH_RE.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** When a pairing created at `createdAt` stops working. */
export function tokenExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + COMPANION_TOKEN_TTL_DAYS * DAY_MS);
}

export type TokenStatus = "active" | "revoked" | "expired";

export function tokenStatus(row: { createdAt: Date; revokedAt: Date | null }, now: Date): TokenStatus {
  if (row.revokedAt) return "revoked";
  return now.getTime() >= tokenExpiresAt(row.createdAt).getTime() ? "expired" : "active";
}

/** The token from `Authorization: Bearer <token>`, or null when the header is absent or empty. */
export function readBearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

/** Trimmed label with control characters removed; throws a CompanionError when empty or too long. */
export function normaliseLabel(label: string): string {
  const clean = label.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) throw new CompanionError("invalid", MSG.labelRequired);
  if (clean.length > COMPANION_LABEL_MAX) throw new CompanionError("invalid", MSG.labelTooLong);
  return clean;
}

// ------------------------------------------------------------------ views

export type PairingView = {
  id: string;
  label: string;
  /** DD MMM YYYY (IST calendar day). */
  created: string;
  /** DD MMM YYYY HH:mm IST, or null when the pairing has never been used. */
  lastUsed: string | null;
  /** DD MMM YYYY — the day it stops working (COMPANION_TOKEN_TTL_DAYS after creation). */
  expires: string;
};

type PairingRow = { id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

export function pairingView(row: PairingRow): PairingView {
  return {
    id: row.id,
    label: row.label ?? "Unnamed pairing",
    created: formatDate(row.createdAt),
    lastUsed: row.lastUsedAt ? `${formatDateTimeIst(row.lastUsedAt)} IST` : null,
    expires: formatDate(tokenExpiresAt(row.createdAt)),
  };
}

const ROW_SELECT = { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;

// ------------------------------------------------------------------ service

/** The person's active pairings, newest first, and how many revoked or expired ones are kept on record. */
export async function listPairings(db: TokenOnlyDb, userId: string, now: Date): Promise<{ active: PairingView[]; inactiveCount: number }> {
  const rows: PairingRow[] = await db.companionToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: ROW_SELECT });
  const active = rows.filter((r) => tokenStatus(r, now) === "active");
  return { active: active.map(pairingView), inactiveCount: rows.length - active.length };
}

/**
 * Create a pairing for the signed-in person. Returns the token (show it once, never store it) and
 * the row as it appears in the list. Refused without companion access or over the active limit.
 */
export async function createPairing(
  db: CompanionTokenDb,
  user: CompanionUser,
  label: string,
  now: Date,
  rand?: (n: number) => Buffer,
): Promise<{ token: string; pairing: PairingView }> {
  if (!(await hasCompanionAccess(db, user))) throw new CompanionError("forbidden", MSG.noAccess);
  const clean = normaliseLabel(label);
  const token = generateToken(rand);
  const tokenHash = hashToken(token);

  const row = await db.$transaction(async (tx) => {
    const mine: PairingRow[] = await tx.companionToken.findMany({ where: { userId: user.id, revokedAt: null }, select: ROW_SELECT });
    if (mine.filter((r) => tokenStatus(r, now) === "active").length >= COMPANION_MAX_ACTIVE_TOKENS) throw new CompanionError("limit", MSG.tooManyActive);
    const created: PairingRow = await tx.companionToken.create({ data: { userId: user.id, tokenHash, label: clean, createdAt: now }, select: ROW_SELECT });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "create",
        entity: "CompanionToken",
        entityId: created.id,
        meta: { label: clean, expiresAt: tokenExpiresAt(created.createdAt).toISOString(), scope: "read:next-task" },
      },
    });
    return created;
  });
  return { token, pairing: pairingView(row) };
}

/**
 * Revoke one of the person's own pairings (UPDATE revokedAt; the row stays). Revoking an already
 * revoked pairing changes nothing and writes no second audit event. Allowed even after companion
 * access was turned off, so a person can always switch a paired browser off.
 */
export async function revokePairing(db: CompanionTokenDb, user: CompanionUser, pairingId: string, now: Date): Promise<{ revoked: boolean }> {
  return db.$transaction(async (tx) => {
    const row = await tx.companionToken.findFirst({ where: { id: pairingId, userId: user.id }, select: { id: true, label: true, revokedAt: true } });
    if (!row) throw new CompanionError("not-found", MSG.pairingNotFound);
    if (row.revokedAt) return { revoked: false };
    await tx.companionToken.update({ where: { id: row.id }, data: { revokedAt: now } });
    await tx.auditEvent.create({ data: { actorId: user.id, action: "revoke", entity: "CompanionToken", entityId: row.id, meta: { label: row.label } } });
    return { revoked: true };
  });
}

export type VerifyFailure = "missing" | "unknown" | "revoked" | "expired";
export type VerifyResult = { ok: true; tokenId: string; userId: string } | { ok: false; reason: VerifyFailure };

/**
 * Check a presented token. Malformed tokens are refused without a query. The row is found by its
 * hash and the hashes compared again in constant time. An accepted token's lastUsedAt is updated.
 */
export async function verifyPairing(db: TokenOnlyDb, raw: string | null, now: Date): Promise<VerifyResult> {
  if (!raw) return { ok: false, reason: "missing" };
  if (!isTokenShape(raw)) return { ok: false, reason: "unknown" };
  const hash = hashToken(raw);
  const row = await db.companionToken.findUnique({ where: { tokenHash: hash }, select: { id: true, userId: true, tokenHash: true, createdAt: true, revokedAt: true } });
  if (!row || !hashesEqual(row.tokenHash, hash)) return { ok: false, reason: "unknown" };
  const status = tokenStatus(row, now);
  if (status !== "active") return { ok: false, reason: status };
  await db.companionToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  return { ok: true, tokenId: row.id, userId: row.userId };
}

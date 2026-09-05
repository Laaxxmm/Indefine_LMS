// Encrypt a secret before it goes into a database column, so a database read
// (dashboard, backup, leaked DATABASE_URL) does not hand out a live credential.
// AES-256-GCM with a random 96-bit nonce; the stored form is
//   enc:v1:<nonce b64>:<tag b64>:<ciphertext b64>
// A value without the prefix is treated as legacy plaintext and returned as-is,
// so rows written before a key existed keep working until they are rewritten.
// Asserted by scripts/verify-secret-box.ts.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

/** 32-byte key from a 64-hex-character env value (`openssl rand -hex 32`), or null when unset. */
export function keyFromEnv(name: string): Buffer | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 64 hex characters (openssl rand -hex 32)`);
  return Buffer.from(v, "hex");
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function seal(plain: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${nonce.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a sealed value. Legacy plaintext passes through. Throws on a wrong key or tampering. */
export function open(stored: string, key: Buffer | null): string {
  if (!isSealed(stored)) return stored;
  if (!key) throw new Error("Encrypted value but no key configured");
  const [nonce, tag, ct] = stored.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

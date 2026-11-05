// Encrypt a secret before it goes into a database column, so a database read
// (dashboard, backup, leaked DATABASE_URL) does not hand out a live credential.
// AES-256-GCM with a random 96-bit nonce; the stored form is
//   enc:v1:<nonce b64>:<tag b64>:<ciphertext b64>
//
// Once a key is configured, ONLY a sealed value is accepted (security audit #15): a plaintext
// value in the column is refused, because anyone who can write the row (a SQL injection, a
// leaked DATABASE_URL, a restored backup) could otherwise swap in a credential of their choosing
// — a Graph refresh token or Turia cookie that the server would then use as the firm's own
// (confused deputy). Rows written before the key existed can be read during a migration window
// with LEGACY_PLAINTEXT_SECRETS=true; each kind of secret read that way is logged once per process,
// and the next write re-encrypts it. Turn the flag off as soon as the rows are rewritten.
// Without a key, plaintext passes through here; callers decide whether that is allowed
// (src/lib/graph.ts refuses in production; src/lib/neo-centra/turia.ts always needs its key).
// Asserted by scripts/verify-secret-box.ts and src/lib/secret-box.test.ts.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
export const LEGACY_PLAINTEXT_ENV = "LEGACY_PLAINTEXT_SECRETS";

/** A plaintext value where a sealed one is required. */
export class PlaintextSecretError extends Error {
  constructor(label: string) {
    super(`The stored ${label} is not encrypted, so it was refused. Store it again (it is encrypted on write), or set ${LEGACY_PLAINTEXT_ENV}=true for a short migration window.`);
    this.name = "PlaintextSecretError";
  }
}

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

/** LEGACY_PLAINTEXT_SECRETS=true: plaintext rows are still read while a key is configured (migration only). */
export function legacyPlaintextAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env[LEGACY_PLAINTEXT_ENV]?.trim().toLowerCase() === "true";
}

export function seal(plain: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${nonce.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

const warnedLegacy = new Set<string>();

/**
 * Decrypt a stored value. With a key: a sealed value is decrypted (throws on a wrong key or
 * tampering) and a plaintext value throws PlaintextSecretError, unless LEGACY_PLAINTEXT_SECRETS=true
 * (then it is returned and the use logged once per label). Without a key: a sealed value throws,
 * a plaintext value is returned (the caller decides whether keyless storage is allowed at all).
 */
export function open(stored: string, key: Buffer | null, label = "secret"): string {
  if (isSealed(stored)) {
    if (!key) throw new Error("Encrypted value but no key configured");
    const [nonce, tag, ct] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  }
  if (!key) return stored;
  if (!legacyPlaintextAllowed()) throw new PlaintextSecretError(label);
  if (!warnedLegacy.has(label)) {
    warnedLegacy.add(label);
    console.warn(`[secret-box] ${LEGACY_PLAINTEXT_ENV}=true: read an unencrypted ${label} while a key is configured. It is encrypted on its next write; turn the flag off once every row is rewritten.`);
  }
  return stored;
}

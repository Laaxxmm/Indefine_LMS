// The result every corrections / privacy service function returns, mapped to JSON by its route
// (same shape as src/lib/agents/service.ts ServiceResult). `error` is always a plain sentence a
// person can act on: what is wrong and what to do. No codes in it.
export type FailStatus = 400 | 401 | 403 | 404 | 409 | 429;

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: FailStatus; error: string };

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
export const fail = (status: FailStatus, error: string): { ok: false; status: FailStatus; error: string } => ({ ok: false, status, error });

/**
 * Thrown inside a transaction to stop it with a person-facing refusal; the service catches it and
 * returns fail(status, message). Nothing written in the transaction is kept.
 */
export class Refusal extends Error {
  constructor(
    public readonly status: FailStatus,
    message: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

/** Prisma unique-constraint violation (P2002), from the real client or the test fake. */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

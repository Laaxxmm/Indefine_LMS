// Errors from the pairing service, each with the plain sentence to show and the HTTP status the
// route answers with.
export type CompanionErrorKind = "forbidden" | "invalid" | "limit" | "not-found";

const STATUS: Record<CompanionErrorKind, number> = { forbidden: 403, invalid: 400, limit: 409, "not-found": 404 };

export class CompanionError extends Error {
  readonly status: number;
  constructor(
    readonly kind: CompanionErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CompanionError";
    this.status = STATUS[kind];
  }
}

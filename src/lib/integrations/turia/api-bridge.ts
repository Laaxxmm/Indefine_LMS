// ApiBridge — not available (ADR-003). Turia publishes no API; the read endpoints Neo Centra
// uses are the web app's internal calls, and Firm OS does not reverse-engineer writes against
// them. Every method throws TuriaBlockedError naming the human action. If Turia ever supplies
// documented endpoints and credentials, implement them here and nowhere else.
import type {
  TuriaAdapter, TuriaLookup, TuriaOpResult,
} from "./adapter";
import { NO_TURIA_API_ACTION, TuriaBlockedError } from "./errors";

export class ApiBridge implements TuriaAdapter {
  readonly mode = "API" as const;

  private unavailable(): never {
    throw new TuriaBlockedError(NO_TURIA_API_ACTION);
  }

  async createClient(): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async addService(): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async createTask(): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async closeTask(): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async findClientByCode(): Promise<TuriaLookup> {
    return this.unavailable();
  }
}

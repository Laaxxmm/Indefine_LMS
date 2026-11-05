// ApiBridge — not available (ADR-003). Turia publishes no API; the read endpoints Neo Centra
// uses are the web app's internal calls, and Firm OS does not reverse-engineer writes against
// them. Every method throws TuriaBlockedError naming the human action. If Turia ever supplies
// documented endpoints and credentials, implement them here and nowhere else.
import type {
  TuriaAdapter, TuriaClientInput, TuriaCloseContext, TuriaLookup, TuriaOpResult, TuriaServiceInput, TuriaTaskInput,
} from "./adapter";
import { NO_TURIA_API_ACTION, TuriaBlockedError } from "./errors";

export class ApiBridge implements TuriaAdapter {
  readonly mode = "API" as const;

  private unavailable(): never {
    throw new TuriaBlockedError(NO_TURIA_API_ACTION);
  }

  async createClient(_input: TuriaClientInput): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async addService(_input: TuriaServiceInput): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async createTask(_input: TuriaTaskInput): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async closeTask(_taskRef: string, _minutes: number, _ctx?: TuriaCloseContext): Promise<TuriaOpResult> {
    return this.unavailable();
  }
  async findClientByCode(_code: string): Promise<TuriaLookup> {
    return this.unavailable();
  }
}

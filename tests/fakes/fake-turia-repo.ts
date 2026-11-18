// In-memory TuriaSyncRepo for tests (ManualBridge, onboarding saga). Never removes a row.
import type { NewTuriaSync, TuriaSyncPatch, TuriaSyncRecord, TuriaSyncRepo } from "@/lib/integrations/turia/manual-bridge";

export class FakeTuriaRepo implements TuriaSyncRepo {
  readonly rows: TuriaSyncRecord[] = [];
  private seq = 0;
  /** Throw on the next create() (failure injection). */
  failNextCreate: Error | null = null;

  async findByKey(key: string) {
    const hits = this.rows.filter((r) => r.evidence?.key === key);
    return hits.length ? hits[hits.length - 1] : null;
  }

  async create(row: NewTuriaSync) {
    if (this.failNextCreate) {
      const e = this.failNextCreate;
      this.failNextCreate = null;
      throw e;
    }
    const at = new Date(Date.UTC(2026, 10, 5, 10, 0, this.seq));
    const rec: TuriaSyncRecord = {
      id: `sync-${++this.seq}`,
      jobTaskId: row.jobTaskId,
      firmClientId: row.firmClientId,
      operation: row.operation,
      mode: row.mode,
      status: row.status,
      turiaRef: null,
      minutesLogged: null,
      evidence: row.evidence,
      confirmedById: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(rec);
    return rec;
  }

  async get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async update(id: string, patch: TuriaSyncPatch) {
    const rec = this.rows.find((r) => r.id === id);
    if (!rec) throw new Error(`no sync ${id}`);
    Object.assign(rec, patch, { updatedAt: new Date(rec.updatedAt.getTime() + 1000) });
    return rec;
  }
}
